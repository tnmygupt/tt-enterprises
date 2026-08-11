"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { TransportInput } from "@/components/TransportInput";
import { useLocale, useTranslations } from "next-intl";
import { AdminAccessDenied } from "@/components/AdminAccessDenied";
import { AdminShell } from "@/components/AdminShell";
import { NumberField } from "@/components/NumberField";
import { useDb, useSession } from "@/lib/hooks";
import { formatInr } from "@/lib/pricing";
import {
  approveDealer,
  assignSchemeToUser,
  checkCapability,
  createDealerUserAsync,
  createStaffUserAsync,
  creditWallet,
  deleteUserAccount,
  getUserHistorySummary,
  rejectDealer,
  restoreUserAccess,
  revokeUserAccess,
  setUserPassword,
  upsertUser,
} from "@/lib/store/db";
import {
  ALL_CAPABILITIES,
  OWNER_ONLY_CAPABILITIES,
  capabilityLabel,
  capabilityOverridesFromChecked,
  effectiveCapabilities,
  rolePresetCapabilities,
} from "@/lib/capabilities";
import { notifyUserPush } from "@/lib/push-client";
import type { Capability, UserProfile, UserRole } from "@/lib/types";

type PeopleTab = "dealers" | "staff" | "tools";

const STAFF_ROLES: UserRole[] = [
  "sales",
  "accounts",
  "dispatch",
  "viewer",
  "super_admin",
];

function StaffPermissionsPanel({
  role,
  checked,
  onChange,
  locale,
  disabled,
  title,
}: {
  role: UserRole;
  checked: Capability[];
  onChange: (next: Capability[]) => void;
  locale: "en" | "hi";
  disabled?: boolean;
  title?: string;
}) {
  const set = new Set(checked);
  const isOwnerRole = role === "super_admin";
  return (
    <div className="rounded-lg border border-[var(--line)] bg-[var(--surface)] p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold text-[var(--ink)]">
          {title ||
            (locale === "hi" ? "अनुमतियाँ" : "Permissions")}
        </p>
        {!isOwnerRole && !disabled ? (
          <button
            type="button"
            className="text-xs font-semibold text-[var(--brand)] underline underline-offset-2"
            onClick={() => onChange(rolePresetCapabilities(role))}
          >
            {locale === "hi"
              ? "रोल डिफ़ॉल्ट पर रीसेट"
              : "Reset to role defaults"}
          </button>
        ) : null}
      </div>
      {isOwnerRole ? (
        <p className="text-xs text-[var(--ink-muted)]">
          {locale === "hi"
            ? "सुपर एडमिन के पास सभी अनुमतियाँ होती हैं।"
            : "Super admin always has the full owner permission set."}
        </p>
      ) : (
        <div className="grid gap-1.5 sm:grid-cols-2">
          {ALL_CAPABILITIES.map((cap) => {
            const ownerOnly = OWNER_ONLY_CAPABILITIES.includes(cap);
            return (
              <label
                key={cap}
                className="flex items-start gap-2 text-sm text-[var(--ink)]"
              >
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={set.has(cap)}
                  disabled={disabled}
                  onChange={(e) => {
                    const next = new Set(set);
                    if (e.target.checked) next.add(cap);
                    else next.delete(cap);
                    onChange(ALL_CAPABILITIES.filter((c) => next.has(c)));
                  }}
                />
                <span>
                  {capabilityLabel(cap, locale)}
                  {ownerOnly ? (
                    <span className="ml-1 text-[10px] text-[var(--ink-muted)]">
                      ({locale === "hi" ? "ओनर" : "owner"})
                    </span>
                  ) : null}
                </span>
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function AdminUsersPage() {
  const t = useTranslations();
  const locale = useLocale() as "en" | "hi";
  const { db, refresh } = useDb();
  const { session } = useSession();
  const [tab, setTab] = useState<PeopleTab>("dealers");
  const [createBusy, setCreateBusy] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    const onSyncErr = (ev: Event) => {
      const detail = (ev as CustomEvent<string>).detail;
      if (detail) setMsg(detail);
    };
    window.addEventListener("tt-sync-error", onSyncErr);
    return () => window.removeEventListener("tt-sync-error", onSyncErr);
  }, []);

  const [form, setForm] = useState({
    name: "",
    phone: "",
    password: "staff123",
    role: "sales" as UserRole,
    caps: rolePresetCapabilities("sales") as Capability[],
  });
  const [permEditId, setPermEditId] = useState<string | null>(null);
  const [walletForm, setWalletForm] = useState({
    userId: "",
    amount: 500,
    reason: "Wallet deposit",
  });
  const [assignForm, setAssignForm] = useState({ userId: "", schemeId: "" });
  const [dealerForm, setDealerForm] = useState({
    name: "",
    phone: "",
    password: "",
    company: "",
    address: "",
    pincode: "",
    gstOrAadhar: "",
    transport: "",
  });
  /** Which users have their password currently revealed in the table. */
  const [revealed, setRevealed] = useState<Set<string>>(new Set());
  const [viewUserId, setViewUserId] = useState<string | null>(null);
  const toggleReveal = (id: string) => {
    setRevealed((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const viewingUser = useMemo(
    () => (db?.users ?? []).find((u) => u.id === viewUserId) ?? null,
    [db, viewUserId]
  );

  const viewingHistory = useMemo(
    () => (viewUserId ? getUserHistorySummary(viewUserId) : null),
    // `db` is read inside getUserHistorySummary — recompute after each sync
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [viewUserId, db]
  );

  const pending = useMemo(
    () =>
      (db?.users ?? []).filter(
        (u) => u.role === "customer" && !u.approved && u.active
      ),
    [db]
  );

  const dealers = useMemo(
    () => (db?.users ?? []).filter((u) => u.role === "customer"),
    [db]
  );

  const staff = useMemo(
    () => (db?.users ?? []).filter((u) => u.role !== "customer"),
    [db]
  );

  const onCreate = async (e: FormEvent) => {
    e.preventDefault();
    if (createBusy) return;
    if (!session || session.role !== "super_admin") {
      setMsg(
        locale === "hi"
          ? "केवल सुपर एडमिन स्टाफ बना सकता है"
          : "Only a super admin can create staff"
      );
      return;
    }
    setCreateBusy(true);
    try {
      const overrides = capabilityOverridesFromChecked(form.role, form.caps);
      const created = await createStaffUserAsync({
        name: form.name,
        phone: form.phone,
        password: form.password,
        role: form.role,
        extraCapabilities: overrides.extraCapabilities,
        deniedCapabilities: overrides.deniedCapabilities,
      });
      setMsg(
        locale === "hi"
          ? `${created.name} (${form.role}) बन गया — पासवर्ड: ${created.passwordVisible || form.password} · सभी डिवाइस पर दिखेगा`
          : `${created.name} (${form.role}) created — password: ${created.passwordVisible || form.password} · visible on all devices`
      );
      setForm({
        name: "",
        phone: "",
        password: "staff123",
        role: "sales",
        caps: rolePresetCapabilities("sales"),
      });
      setTab("staff");
      refresh();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Failed to create user");
    } finally {
      setCreateBusy(false);
    }
  };

  const onCreateDealer = async (e: FormEvent) => {
    e.preventDefault();
    if (!session || createBusy) return;
    setCreateBusy(true);
    try {
      const dealer = await createDealerUserAsync({
        ...dealerForm,
        byAdminId: session.id,
      });
      setMsg(
        locale === "hi"
          ? `${dealer.name} बन गया — पासवर्ड: ${dealer.passwordVisible} · सभी डिवाइस पर`
          : `${dealer.name} created — password: ${dealer.passwordVisible} · synced to all devices`
      );
      setDealerForm({
        name: "",
        phone: "",
        password: "",
        company: "",
        address: "",
        pincode: "",
        gstOrAadhar: "",
        transport: "",
      });
      refresh();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Failed to create dealer");
    } finally {
      setCreateBusy(false);
    }
  };

  const promptResetPassword = (userId: string, name: string) => {
    if (!session) return;
    const next = window.prompt(
      locale === "hi"
        ? `${name} का नया पासवर्ड? (कम से कम 6 वर्ण)`
        : `New password for ${name}? (min 6 characters)`,
      ""
    );
    if (next === null) return;
    try {
      setUserPassword(userId, next, session.id);
      setMsg(
        locale === "hi"
          ? `${name} का पासवर्ड बदल दिया — नया: ${next.trim()}`
          : `${name}'s password reset — new: ${next.trim()}`
      );
      setRevealed((cur) => new Set(cur).add(userId));
      refresh();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Reset failed");
    }
  };

  if (!session || !checkCapability(session, db?.users, "manage_users")) {
    return (
      <AdminShell>
        <AdminAccessDenied />
      </AdminShell>
    );
  }

  const isOwner = session.role === "super_admin";
  const permEditUser =
    (db?.users ?? []).find((u) => u.id === permEditId) ?? null;

  const renderPasswordCell = (u: { id: string; passwordVisible?: string; name: string }) => {
    const shown = revealed.has(u.id);
    if (!u.passwordVisible) {
      return (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-[var(--ink-muted)]">
            {locale === "hi" ? "छिपा (डीलर सेट)" : "Hidden (user-set)"}
          </span>
          <button
            type="button"
            className="text-xs font-semibold text-[var(--brand)] underline underline-offset-2"
            onClick={() => promptResetPassword(u.id, u.name)}
          >
            {locale === "hi" ? "रीसेट" : "Reset"}
          </button>
        </div>
      );
    }
    return (
      <div className="flex flex-wrap items-center gap-1.5">
        <code className="rounded bg-[var(--surface-2)] px-1.5 py-0.5 font-mono text-xs">
          {shown ? u.passwordVisible : "••••••••"}
        </code>
        <button
          type="button"
          className="text-xs font-semibold text-[var(--brand)] underline underline-offset-2"
          onClick={() => toggleReveal(u.id)}
        >
          {shown
            ? locale === "hi"
              ? "छिपाएँ"
              : "Hide"
            : locale === "hi"
              ? "दिखाएँ"
              : "Show"}
        </button>
        {shown ? (
          <button
            type="button"
            className="text-xs font-semibold text-[var(--ink-muted)] underline underline-offset-2"
            onClick={() => {
              void navigator.clipboard?.writeText(u.passwordVisible || "");
              setMsg(locale === "hi" ? "कॉपी हो गया" : "Copied");
            }}
          >
            {locale === "hi" ? "कॉपी" : "Copy"}
          </button>
        ) : null}
        <button
          type="button"
          className="text-xs font-semibold text-[var(--brand)] underline underline-offset-2"
          onClick={() => promptResetPassword(u.id, u.name)}
        >
          {locale === "hi" ? "बदलें" : "Change"}
        </button>
      </div>
    );
  };

  const promptRevoke = (userId: string, name: string) => {
    if (!session) return;
    const reason = window.prompt(
      locale === "hi"
        ? `${name} की एक्सेस रोकने का कारण? (वैकल्पिक)`
        : `Reason for revoking ${name}'s access? (optional)`,
      ""
    );
    if (reason === null) return;
    try {
      revokeUserAccess(userId, session.id, reason);
      setMsg(
        locale === "hi"
          ? `${name} की एक्सेस रोक दी गई`
          : `${name}'s access revoked`
      );
      refresh();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Revoke failed");
    }
  };

  const doRestore = (userId: string, name: string) => {
    if (!session) return;
    try {
      restoreUserAccess(userId, session.id);
      setMsg(
        locale === "hi"
          ? `${name} की एक्सेस फिर से चालू`
          : `${name}'s access restored`
      );
      refresh();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Restore failed");
    }
  };

  const canDeposit =
    !!session && checkCapability(session, db?.users, "manage_wallet");

  const promptDeposit = (userId: string, name: string) => {
    if (!session || !canDeposit) {
      window.alert(
        locale === "hi"
          ? "वॉलेट जमा करने की अनुमति नहीं"
          : "You do not have permission to deposit to wallets"
      );
      return;
    }
    const raw = window.prompt(
      locale === "hi"
        ? `${name} के वॉलेट में कितना ₹ जमा करें?`
        : `Deposit how much ₹ to ${name}'s wallet?`,
      "500"
    );
    if (raw === null) return;
    const amount = Number(raw.replace(/,/g, "").trim());
    if (!Number.isFinite(amount) || amount <= 0) {
      window.alert(
        locale === "hi"
          ? "सकारात्मक राशि डालें"
          : "Enter a positive amount"
      );
      return;
    }
    const reason =
      window.prompt(
        locale === "hi" ? "कारण / नोट (वैकल्पिक)" : "Reason / note (optional)",
        locale === "hi" ? "वॉलेट जमा" : "Wallet deposit"
      ) ?? "";
    try {
      creditWallet({
        userId,
        amount,
        reason: reason.trim() || "Wallet deposit",
        adminId: session.id,
      });
      setMsg(
        locale === "hi"
          ? `${name} के वॉलेट में ${formatInr(amount)} जमा`
          : `Deposited ${formatInr(amount)} to ${name}'s wallet`
      );
      refresh();
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "Deposit failed");
      setMsg(err instanceof Error ? err.message : "Deposit failed");
    }
  };

  const promptDelete = (userId: string, name: string) => {
    if (!session) return;
    const hist = getUserHistorySummary(userId);
    const canHard = hist.canHardDelete;
    if (!canHard) {
      const ok = window.confirm(
        locale === "hi"
          ? `FORCE DELETE: ${name}\n\nऑर्डर: ${hist.orders} · वॉलेट: ${hist.walletTxs} · वाउचर: ${hist.vouchers}\n\nलॉगिन हमेशा हट जाएगा। ऑर्डर/अकाउंट्स बुक में रहेंगे। जारी रखें?`
          : `FORCE DELETE: ${name}\n\nOrders: ${hist.orders} · Wallet txs: ${hist.walletTxs} · Vouchers: ${hist.vouchers}\n\nLogin will be permanently removed. Orders/accounts stay in books. Continue?`
      );
      if (!ok) return;
      const ok2 = window.confirm(
        locale === "hi"
          ? `पक्का FORCE DELETE? यह वापस नहीं होगा।`
          : `Confirm FORCE DELETE? This cannot be undone.`
      );
      if (!ok2) return;
    } else if (
      !window.confirm(
        locale === "hi"
          ? `${name} को हमेशा के लिए हटाएँ?`
          : `Delete ${name} permanently?`
      )
    ) {
      return;
    }
    try {
      deleteUserAccount(userId, session.id, { force: true });
      if (viewUserId === userId) setViewUserId(null);
      setMsg(
        locale === "hi" ? `${name} हटा दिया गया` : `${name} deleted`
      );
      refresh();
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "Delete failed");
      setMsg(err instanceof Error ? err.message : "Delete failed");
    }
  };

  const infoRows = (u: UserProfile) => {
    const rows: { label: string; value: string }[] = [
      { label: locale === "hi" ? "नाम" : "Name", value: u.name },
      { label: locale === "hi" ? "फ़ोन" : "Phone", value: u.phone },
      {
        label: locale === "hi" ? "रोल" : "Role",
        value: u.role,
      },
      {
        label: locale === "hi" ? "कंपनी" : "Company",
        value: u.company || "—",
      },
      {
        label: locale === "hi" ? "पता" : "Address",
        value: u.address || "—",
      },
      {
        label: locale === "hi" ? "पिनकोड" : "Pincode",
        value: u.pincode || "—",
      },
      {
        label: locale === "hi" ? "GST / आधार" : "GST / Aadhaar",
        value: u.gstOrAadhar || "—",
      },
      {
        label: locale === "hi" ? "ट्रांसपोर्ट" : "Transport",
        value: u.transport || "—",
      },
      {
        label: locale === "hi" ? "वॉलेट" : "Wallet",
        value: formatInr(u.walletBalance),
      },
      {
        label: locale === "hi" ? "लिफ्टिंग kg" : "Lifting kg",
        value: String(u.liftingProgressKg ?? 0),
      },
      {
        label: locale === "hi" ? "स्कीम" : "Schemes",
        value: (u.assignedSchemeIds ?? []).length
          ? (u.assignedSchemeIds ?? [])
              .map(
                (id) =>
                  db?.schemes.find((s) => s.id === id)?.name[locale] || id
              )
              .join(", ")
          : "—",
      },
      {
        label: locale === "hi" ? "स्टेटस" : "Status",
        value: !u.active
          ? locale === "hi"
            ? "एक्सेस बंद"
            : "Revoked"
          : u.approved
            ? locale === "hi"
              ? "अप्रूव्ड"
              : "Approved"
            : locale === "hi"
              ? "पेंडिंग"
              : "Pending",
      },
      {
        label: locale === "hi" ? "बना" : "Created",
        value: u.createdAt
          ? new Date(u.createdAt).toLocaleString(
              locale === "hi" ? "hi-IN" : "en-IN"
            )
          : "—",
      },
    ];
    if (u.revokedAt) {
      rows.push({
        label: locale === "hi" ? "रोका गया" : "Revoked at",
        value: new Date(u.revokedAt).toLocaleString(
          locale === "hi" ? "hi-IN" : "en-IN"
        ),
      });
    }
    if (u.revokedReason) {
      rows.push({
        label: locale === "hi" ? "कारण" : "Reason",
        value: u.revokedReason,
      });
    }
    if (u.passwordVisible) {
      rows.push({
        label: locale === "hi" ? "पासवर्ड" : "Password",
        value: u.passwordVisible,
      });
    }
    return rows;
  };

  const tabs: { key: PeopleTab; label: string }[] = [
    { key: "dealers", label: t("admin.tabDealers") },
    { key: "staff", label: t("admin.tabStaff") },
    { key: "tools", label: t("admin.tabTools") },
  ];

  return (
    <AdminShell>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{t("admin.users")}</h1>
          <p className="mt-1 text-sm text-[var(--ink-muted)]">
            {t("admin.usersHint")}
          </p>
        </div>
        {tab === "staff" ? (
          <button
            type="button"
            className="tt-btn tt-btn-dark"
            onClick={() => {
              document.getElementById("create-staff-form")?.scrollIntoView({
                behavior: "smooth",
              });
            }}
          >
            {t("admin.createStaff")}
          </button>
        ) : null}
        {tab === "dealers" ? (
          <button
            type="button"
            className="tt-btn tt-btn-dark"
            onClick={() => {
              document
                .getElementById("create-dealer-form")
                ?.scrollIntoView({ behavior: "smooth" });
            }}
          >
            {locale === "hi" ? "+ नया डीलर" : "+ Create dealer"}
          </button>
        ) : null}
      </div>

      {msg ? (
        <p
          className={`mt-3 rounded-lg px-3 py-2 text-sm font-medium ${
            /fail|error|required|invalid|exist|sync|conflict|only|disabled|denied|cannot|could not/i.test(
              msg
            )
              ? "bg-red-50 text-[var(--danger)]"
              : "bg-[#e8f2ea] text-[var(--ok)]"
          }`}
        >
          {msg}
        </p>
      ) : null}

      {viewingUser ? (
        <div className="tt-panel mt-4 space-y-3 border-2 border-[var(--brand)]/30 p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-[var(--brand-deep)]">
                {locale === "hi" ? "यूज़र जानकारी" : "User info"}
              </h2>
              <p className="text-xs text-[var(--ink-muted)]">
                {viewingUser.name} · {viewingUser.phone}
              </p>
            </div>
            <button
              type="button"
              className="tt-btn tt-btn-outline"
              onClick={() => setViewUserId(null)}
            >
              {locale === "hi" ? "बंद करें" : "Close"}
            </button>
          </div>
          <dl className="grid gap-2 sm:grid-cols-2">
            {infoRows(viewingUser).map((row) => (
              <div
                key={row.label}
                className="rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 py-2"
              >
                <dt className="text-[10px] font-bold uppercase tracking-wide text-[var(--ink-muted)]">
                  {row.label}
                </dt>
                <dd className="mt-0.5 break-words text-sm font-medium text-[var(--ink)]">
                  {row.value}
                </dd>
              </div>
            ))}
          </dl>
          {viewingHistory ? (
            <div className="rounded-xl bg-[var(--surface-2)] px-3 py-2 text-xs text-[var(--ink)]">
              {locale === "hi" ? "इतिहास: " : "History: "}
              <strong>{viewingHistory.orders}</strong>{" "}
              {locale === "hi" ? "ऑर्डर" : "orders"} ·{" "}
              <strong>{viewingHistory.walletTxs}</strong>{" "}
              {locale === "hi" ? "वॉलेट" : "wallet"} ·{" "}
              <strong>{viewingHistory.vouchers}</strong>{" "}
              {locale === "hi" ? "वाउचर" : "vouchers"}
              {!viewingHistory.canHardDelete ? (
                <span className="ml-2 text-[var(--danger)]">
                  {locale === "hi"
                    ? "(Delete = force delete)"
                    : "(Delete = force delete)"}
                </span>
              ) : null}
            </div>
          ) : null}
          <div className="flex flex-wrap gap-2">
            {(() => {
              const otherOwners = (db?.users ?? []).filter(
                (x) =>
                  x.id !== viewingUser.id &&
                  x.role === "super_admin" &&
                  x.active
              ).length;
              const lockedOwner =
                viewingUser.role === "super_admin" && otherOwners === 0;
              if (viewingUser.id === session.id || lockedOwner) return null;
              return (
              <>
                {canDeposit && viewingUser.role === "customer" ? (
                  <button
                    type="button"
                    className="tt-btn tt-btn-dark"
                    onClick={() =>
                      promptDeposit(viewingUser.id, viewingUser.name)
                    }
                  >
                    {locale === "hi" ? "वॉलेट में जमा" : "Deposit to wallet"}
                  </button>
                ) : null}
                {viewingUser.active ? (
                  <button
                    type="button"
                    className="tt-btn tt-btn-outline text-[var(--danger)]"
                    onClick={() => promptRevoke(viewingUser.id, viewingUser.name)}
                  >
                    {locale === "hi" ? "एक्सेस रोकें" : "Revoke access"}
                  </button>
                ) : (
                  <button
                    type="button"
                    className="tt-btn tt-btn-outline"
                    onClick={() => doRestore(viewingUser.id, viewingUser.name)}
                  >
                    {locale === "hi" ? "फिर चालू" : "Restore"}
                  </button>
                )}
                <button
                  type="button"
                  className="tt-btn tt-btn-outline text-[var(--danger)]"
                  onClick={() => promptDelete(viewingUser.id, viewingUser.name)}
                >
                  {locale === "hi" ? "Force Delete" : "Force Delete"}
                </button>
              </>
              );
            })()}
          </div>
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-2">
        {tabs.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setTab(f.key)}
            className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${
              tab === f.key
                ? "tt-selected bg-[var(--brand-deep)] text-white"
                : "border border-[var(--line)] bg-white text-[var(--ink-muted)]"
            }`}
          >
            {f.label}
            {f.key === "dealers" && pending.length ? (
              <span className="ml-1.5 rounded bg-amber-400 px-1.5 py-0.5 text-xs text-amber-950">
                {pending.length}
              </span>
            ) : null}
          </button>
        ))}
      </div>

      {tab === "dealers" ? (
        <>
          {pending.length ? (
            <div className="mt-5 rounded-2xl border border-amber-300 bg-amber-50 p-5">
              <h2 className="font-semibold text-amber-900">
                {t("admin.pendingApproval")} ({pending.length})
              </h2>
              <ul className="mt-4 space-y-3">
                {pending.map((u) => (
                  <li
                    key={u.id}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-white px-4 py-3 text-sm"
                  >
                    <div>
                      <p className="font-semibold">{u.name}</p>
                      <p className="text-[var(--ink-muted)]">
                        {u.phone}
                        {u.company ? ` · ${u.company}` : ""}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        className="tt-btn tt-btn-dark"
                        onClick={() => {
                          approveDealer(u.id, session.id);
                          setMsg(
                            locale === "hi"
                              ? `${u.name} अप्रूव हो गया`
                              : `${u.name} approved`
                          );
                          // Only lands if they already have a device
                          // subscribed — a first-time dealer has never
                          // been able to log in.
                          void notifyUserPush({
                            userId: u.id,
                            title:
                              u.locale === "hi"
                                ? "अकाउंट मंज़ूर"
                                : "Account approved",
                            body:
                              u.locale === "hi"
                                ? "अब आप लॉगिन करके ऑर्डर कर सकते हैं"
                                : "You can now login and place orders",
                            url: `/${u.locale === "hi" ? "hi" : "en"}/catalog`,
                          });
                          refresh();
                        }}
                      >
                        {t("admin.approve")}
                      </button>
                      <button
                        type="button"
                        className="tt-btn tt-btn-outline text-[var(--danger)]"
                        onClick={() => {
                          if (
                            !confirm(
                              locale === "hi"
                                ? "इस रजिस्ट्रेशन को अस्वीकार करें?"
                                : "Reject this registration?"
                            )
                          )
                            return;
                          rejectDealer(u.id, session.id);
                          setMsg(
                            locale === "hi"
                              ? `${u.name} अस्वीकृत`
                              : `${u.name} rejected`
                          );
                          refresh();
                        }}
                      >
                        {t("admin.reject")}
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="tt-panel mt-5 overflow-x-auto">
            <table className="tt-table min-w-[1200px]">
              <thead>
                <tr>
                  <th>{t("common.name")}</th>
                  <th>{t("common.phone")}</th>
                  <th>{t("common.status")}</th>
                  <th>{t("common.wallet")}</th>
                  <th>Lifting kg</th>
                  <th>{locale === "hi" ? "पासवर्ड" : "Password"}</th>
                  <th>{t("common.actions")}</th>
                </tr>
              </thead>
              <tbody>
                {dealers.map((u) => (
                  <tr key={u.id}>
                    <td>
                      <button
                        type="button"
                        className="text-left"
                        onClick={() => setViewUserId(u.id)}
                      >
                        <div className="font-medium text-[var(--brand)] underline-offset-2 hover:underline">
                          {u.name}
                        </div>
                        {u.company ? (
                          <div className="text-xs text-[var(--ink-muted)]">
                            {u.company}
                          </div>
                        ) : null}
                      </button>
                    </td>
                    <td className="font-mono text-sm">{u.phone}</td>
                    <td>
                      {!u.active ? (
                        <span
                          className="text-xs font-semibold text-[var(--danger)]"
                          title={
                            u.revokedReason ||
                            (u.revokedAt
                              ? `Revoked ${new Date(u.revokedAt).toLocaleString(
                                  locale === "hi" ? "hi-IN" : "en-IN"
                                )}`
                              : "")
                          }
                        >
                          {locale === "hi" ? "एक्सेस बंद" : "Revoked"}
                        </span>
                      ) : u.approved ? (
                        <span className="text-xs font-semibold text-[var(--ok)]">
                          {locale === "hi" ? "अप्रूव्ड" : "Approved"}
                        </span>
                      ) : (
                        <button
                          type="button"
                          className="text-xs font-semibold text-[var(--brand)]"
                          onClick={() => {
                            approveDealer(u.id, session.id);
                            refresh();
                          }}
                        >
                          {t("admin.approve")}
                        </button>
                      )}
                    </td>
                    <td>{formatInr(u.walletBalance)}</td>
                    <td>{u.liftingProgressKg}</td>
                    <td>{renderPasswordCell(u)}</td>
                    <td>
                      <div className="flex flex-wrap gap-1.5">
                        <button
                          type="button"
                          className="text-xs font-semibold text-[var(--brand)] underline underline-offset-2"
                          onClick={() => setViewUserId(u.id)}
                        >
                          {locale === "hi" ? "जानकारी" : "Info"}
                        </button>
                        {canDeposit ? (
                          <button
                            type="button"
                            className="text-xs font-semibold text-[var(--ok)] underline underline-offset-2"
                            onClick={() => promptDeposit(u.id, u.name)}
                          >
                            {locale === "hi" ? "जमा" : "Deposit"}
                          </button>
                        ) : null}
                        {u.active ? (
                          <button
                            type="button"
                            className="text-xs font-semibold text-[var(--danger)] underline underline-offset-2"
                            onClick={() => promptRevoke(u.id, u.name)}
                          >
                            {locale === "hi" ? "एक्सेस रोकें" : "Revoke access"}
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="text-xs font-semibold text-[var(--ok)] underline underline-offset-2"
                            onClick={() => doRestore(u.id, u.name)}
                          >
                            {locale === "hi" ? "फिर चालू" : "Restore"}
                          </button>
                        )}
                        <button
                          type="button"
                          className="text-xs font-semibold text-[var(--danger)] underline underline-offset-2"
                          onClick={() => promptDelete(u.id, u.name)}
                          title={
                            locale === "hi"
                              ? "Force delete — लॉगिन हटाएँ"
                              : "Force delete — remove login"
                          }
                        >
                          {locale === "hi" ? "हटाएँ" : "Delete"}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!dealers.length ? (
              <p className="p-6 text-sm text-[var(--ink-muted)]">
                {t("common.empty")}
              </p>
            ) : null}
          </div>

          <form
            id="create-dealer-form"
            onSubmit={onCreateDealer}
            className="tt-panel mt-5 space-y-3 p-5"
          >
            <div className="flex flex-wrap items-end justify-between gap-2">
              <div>
                <h2 className="font-semibold">
                  {locale === "hi" ? "नया डीलर बनाएँ" : "Create dealer"}
                </h2>
                <p className="text-xs text-[var(--ink-muted)]">
                  {locale === "hi"
                    ? "एडमिन द्वारा बनाया गया — अप्रूवल की ज़रूरत नहीं। पासवर्ड यहीं देख सकते हैं।"
                    : "Admin-created — no approval wait. Password stays visible in this table."}
                </p>
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <input
                className="tt-input"
                placeholder={t("common.name")}
                value={dealerForm.name}
                onChange={(e) =>
                  setDealerForm({ ...dealerForm, name: e.target.value })
                }
                required
              />
              <input
                className="tt-input"
                type="tel"
                inputMode="numeric"
                placeholder={t("common.phone")}
                value={dealerForm.phone}
                onChange={(e) =>
                  setDealerForm({ ...dealerForm, phone: e.target.value })
                }
                required
              />
              <input
                className="tt-input"
                type="text"
                placeholder={locale === "hi" ? "पासवर्ड" : "Password"}
                value={dealerForm.password}
                onChange={(e) =>
                  setDealerForm({ ...dealerForm, password: e.target.value })
                }
                required
              />
              <input
                className="tt-input"
                placeholder={locale === "hi" ? "कंपनी (वैकल्पिक)" : "Company (optional)"}
                value={dealerForm.company}
                onChange={(e) =>
                  setDealerForm({ ...dealerForm, company: e.target.value })
                }
              />
              <input
                className="tt-input sm:col-span-2"
                placeholder={locale === "hi" ? "पता" : "Address"}
                value={dealerForm.address}
                onChange={(e) =>
                  setDealerForm({ ...dealerForm, address: e.target.value })
                }
              />
              <input
                className="tt-input"
                placeholder={locale === "hi" ? "पिनकोड" : "Pincode"}
                value={dealerForm.pincode}
                onChange={(e) =>
                  setDealerForm({ ...dealerForm, pincode: e.target.value })
                }
              />
              <input
                className="tt-input"
                placeholder="GST / Aadhaar"
                value={dealerForm.gstOrAadhar}
                onChange={(e) =>
                  setDealerForm({ ...dealerForm, gstOrAadhar: e.target.value })
                }
              />
              <TransportInput
                className="tt-input sm:col-span-2"
                placeholder={locale === "hi" ? "ट्रांसपोर्ट" : "Transport"}
                value={dealerForm.transport}
                onChange={(transport) =>
                  setDealerForm({ ...dealerForm, transport })
                }
              />
            </div>
            <button type="submit" className="tt-btn tt-btn-dark">
              {locale === "hi" ? "डीलर बनाएँ" : "Create dealer"}
            </button>
          </form>
        </>
      ) : null}

      {tab === "staff" ? (
        <>
          <p className="mt-4 text-sm text-[var(--ink-muted)]">
            {t("admin.ownersNote")}
          </p>
          {permEditUser && permEditUser.role !== "customer" && isOwner ? (
            <div className="tt-panel mt-4 space-y-3 p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="font-semibold">
                  {t("admin.customPermissions")} — {permEditUser.name}
                </h2>
                <button
                  type="button"
                  className="tt-btn tt-btn-outline"
                  onClick={() => setPermEditId(null)}
                >
                  {locale === "hi" ? "बंद करें" : "Close"}
                </button>
              </div>
              <StaffPermissionsPanel
                role={permEditUser.role}
                checked={effectiveCapabilities(permEditUser)}
                locale={locale}
                onChange={(caps) => {
                  const overrides = capabilityOverridesFromChecked(
                    permEditUser.role,
                    caps
                  );
                  upsertUser({
                    ...permEditUser,
                    extraCapabilities: overrides.extraCapabilities.length
                      ? overrides.extraCapabilities
                      : undefined,
                    deniedCapabilities: overrides.deniedCapabilities.length
                      ? overrides.deniedCapabilities
                      : undefined,
                  });
                  refresh();
                }}
              />
            </div>
          ) : null}
          <div className="tt-panel mt-5 overflow-x-auto">
            <table className="tt-table min-w-[1100px]">
              <thead>
                <tr>
                  <th>{t("common.name")}</th>
                  <th>{t("common.phone")}</th>
                  <th>Role</th>
                  <th>{t("common.status")}</th>
                  <th>{locale === "hi" ? "पासवर्ड" : "Password"}</th>
                  <th>{t("common.actions")}</th>
                </tr>
              </thead>
              <tbody>
                {staff.map((u) => {
                  const otherOwners = staff.filter(
                    (x) =>
                      x.id !== u.id &&
                      x.role === "super_admin" &&
                      x.active
                  ).length;
                  const locked =
                    u.id === session.id ||
                    (u.role === "super_admin" && otherOwners === 0);
                  return (
                    <tr key={u.id}>
                      <td className="font-medium">
                        {u.name}
                        {u.id === session.id ? (
                          <span className="ml-2 text-xs text-[var(--ink-muted)]">
                            ({locale === "hi" ? "आप" : "you"})
                          </span>
                        ) : null}
                      </td>
                      <td className="font-mono text-sm">{u.phone}</td>
                      <td>
                        <select
                          className="tt-select"
                          value={u.role}
                          disabled={locked || !isOwner}
                          onChange={(e) => {
                            const nextRole = e.target.value as UserRole;
                            if (
                              u.role === "super_admin" &&
                              nextRole !== "super_admin" &&
                              otherOwners === 0
                            ) {
                              setMsg(
                                locale === "hi"
                                  ? "अंतिम ओनर को डिमोट नहीं कर सकते"
                                  : "Cannot demote the last owner"
                              );
                              return;
                            }
                            upsertUser({
                              ...u,
                              role: nextRole,
                              extraCapabilities: undefined,
                              deniedCapabilities: undefined,
                            });
                            refresh();
                          }}
                        >
                          {STAFF_ROLES.map((r) => (
                            <option key={r} value={r}>
                              {r}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        {!u.active ? (
                          <span
                            className="text-xs font-semibold text-[var(--danger)]"
                            title={u.revokedReason || ""}
                          >
                            {locale === "hi" ? "एक्सेस बंद" : "Revoked"}
                          </span>
                        ) : (
                          <span className="text-xs font-semibold text-[var(--ok)]">
                            {locale === "hi" ? "चालू" : "Active"}
                          </span>
                        )}
                      </td>
                      <td>{renderPasswordCell(u)}</td>
                      <td>
                        {locked && u.role === "super_admin" && otherOwners === 0 ? (
                          <span className="text-xs text-[var(--ink-muted)]">
                            {locale === "hi" ? "सुरक्षित" : "Protected"}
                          </span>
                        ) : locked ? (
                          <span className="text-xs text-[var(--ink-muted)]">
                            {locale === "hi" ? "स्वयं" : "Self"}
                          </span>
                        ) : (
                          <div className="flex flex-wrap gap-1.5">
                            <button
                              type="button"
                              className="text-xs font-semibold text-[var(--brand)] underline underline-offset-2"
                              onClick={() => setViewUserId(u.id)}
                            >
                              {locale === "hi" ? "जानकारी" : "Info"}
                            </button>
                            {isOwner && u.role !== "super_admin" ? (
                              <button
                                type="button"
                                className="text-xs font-semibold text-[var(--brand)] underline underline-offset-2"
                                onClick={() => setPermEditId(u.id)}
                              >
                                {t("admin.customPermissions")}
                              </button>
                            ) : null}
                            {u.active ? (
                              <button
                                type="button"
                                className="text-xs font-semibold text-[var(--danger)] underline underline-offset-2"
                                onClick={() => promptRevoke(u.id, u.name)}
                              >
                                {locale === "hi" ? "एक्सेस रोकें" : "Revoke access"}
                              </button>
                            ) : (
                              <button
                                type="button"
                                className="text-xs font-semibold text-[var(--ok)] underline underline-offset-2"
                                onClick={() => doRestore(u.id, u.name)}
                              >
                                {locale === "hi" ? "फिर चालू" : "Restore"}
                              </button>
                            )}
                            <button
                              type="button"
                              className="text-xs font-semibold text-[var(--danger)] underline underline-offset-2"
                              onClick={() => promptDelete(u.id, u.name)}
                            >
                              {locale === "hi" ? "हटाएँ" : "Delete"}
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <form
            id="create-staff-form"
            onSubmit={onCreate}
            className="tt-panel mt-5 max-w-2xl space-y-3 p-5"
          >
            <h2 className="font-semibold">{t("admin.createStaff")}</h2>
            <p className="text-xs text-[var(--ink-muted)]">
              {t("admin.ownersNote")}
            </p>
            <input
              className="tt-input"
              placeholder={t("common.name")}
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required
            />
            <input
              className="tt-input"
              type="tel"
              placeholder={t("common.phone")}
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
              required
            />
            <input
              className="tt-input"
              type="password"
              placeholder="Password"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              required
            />
            <select
              className="tt-select"
              value={form.role}
              disabled={!isOwner}
              onChange={(e) => {
                const role = e.target.value as UserRole;
                setForm({
                  ...form,
                  role,
                  caps: rolePresetCapabilities(role),
                });
              }}
            >
              {STAFF_ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
            {isOwner ? (
              <StaffPermissionsPanel
                role={form.role}
                checked={form.caps}
                locale={locale}
                title={t("admin.customPermissions")}
                onChange={(caps) => setForm({ ...form, caps })}
              />
            ) : null}
            <button
              type="submit"
              className="tt-btn tt-btn-dark"
              disabled={createBusy || !isOwner}
            >
              {t("admin.createStaff")}
            </button>
          </form>
        </>
      ) : null}

      {tab === "tools" ? (
        <div className="mt-5 grid gap-5 lg:grid-cols-2">
          <form
            className="tt-panel space-y-3 p-5"
            onSubmit={(e) => {
              e.preventDefault();
              if (!session || !walletForm.userId) return;
              creditWallet({
                userId: walletForm.userId,
                amount: walletForm.amount,
                reason: walletForm.reason,
                adminId: session.id,
              });
              setMsg(locale === "hi" ? "वॉलेट अपडेट" : "Wallet updated");
              refresh();
            }}
          >
            <h2 className="font-semibold">
              {locale === "hi" ? "वॉलेट में जमा / काटें" : "Deposit / adjust wallet"}
            </h2>
            <select
              className="tt-select"
              value={walletForm.userId}
              onChange={(e) =>
                setWalletForm({ ...walletForm, userId: e.target.value })
              }
              required
            >
              <option value="">{t("common.select")}</option>
              {dealers.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name} · {u.phone} ({formatInr(u.walletBalance)})
                </option>
              ))}
            </select>
            <NumberField
              className="tt-input"
              min={0.01}
              step="0.01"
              emptyAs={null}
              placeholder={locale === "hi" ? "जमा राशि ₹" : "Deposit amount ₹"}
              value={walletForm.amount || ""}
              onValueChange={(v) =>
                setWalletForm({
                  ...walletForm,
                  amount: typeof v === "number" ? v : 0,
                })
              }
            />
            <p className="text-xs text-[var(--ink-muted)]">
              {locale === "hi"
                ? "जमा = धनात्मक। काटने के लिए ऋण संख्या डालें।"
                : "Deposit = positive amount. Use a negative number to debit."}
            </p>
            <input
              className="tt-input"
              value={walletForm.reason}
              onChange={(e) =>
                setWalletForm({ ...walletForm, reason: e.target.value })
              }
              placeholder={locale === "hi" ? "कारण" : "Reason"}
            />
            <button type="submit" className="tt-btn tt-btn-dark">
              {locale === "hi" ? "जमा करें" : "Deposit"}
            </button>
          </form>

          <form
            className="tt-panel space-y-3 p-5"
            onSubmit={(e) => {
              e.preventDefault();
              if (!assignForm.userId || !assignForm.schemeId) return;
              assignSchemeToUser(assignForm.userId, assignForm.schemeId);
              setMsg(locale === "hi" ? "स्कीम असाइन" : "Scheme assigned");
              refresh();
            }}
          >
            <h2 className="font-semibold">Assign scheme</h2>
            <select
              className="tt-select"
              value={assignForm.userId}
              onChange={(e) =>
                setAssignForm({ ...assignForm, userId: e.target.value })
              }
              required
            >
              <option value="">{t("admin.tabDealers")}</option>
              {dealers.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name} · {u.phone}
                </option>
              ))}
            </select>
            <select
              className="tt-select"
              value={assignForm.schemeId}
              onChange={(e) =>
                setAssignForm({ ...assignForm, schemeId: e.target.value })
              }
              required
            >
              <option value="">{t("admin.schemes")}</option>
              {(db?.schemes ?? []).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name.en}
                </option>
              ))}
            </select>
            <button type="submit" className="tt-btn tt-btn-dark">
              Assign
            </button>
          </form>
        </div>
      ) : null}
    </AdminShell>
  );
}
