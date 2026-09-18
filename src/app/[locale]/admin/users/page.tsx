"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { TransportInput } from "@/components/TransportInput";
import { useLocale, useTranslations } from "next-intl";
import { AdminAccessDenied } from "@/components/AdminAccessDenied";
import { AdminShell } from "@/components/AdminShell";
import { NumberField } from "@/components/NumberField";
import { PeopleJobsTab } from "@/components/admin/PeopleJobsTab";
import { StaffPermissionsPanel } from "@/components/admin/StaffPermissionsPanel";
import { useDb, useSession } from "@/lib/hooks";
import { formatInr } from "@/lib/pricing";
import {
  assignSchemeToUser,
  assignStaffJob,
  checkCapability,
  createDealerUserAsync,
  createStaffUserAsync,
  creditWallet,
  deleteUserAccountAndSync,
  getUserHistorySummary,
  restoreUserAccess,
  revokeUserAccess,
  setUserPasswordAsync,
  upsertUser,
} from "@/lib/store/db";
import {
  capabilityContextFrom,
  capabilityOverridesFromChecked,
  effectiveCapabilities,
  rolePresetCapabilities,
  staffJobLabel,
  staffRoleLabel,
} from "@/lib/capabilities";
import { notifyUserPush } from "@/lib/push-client";
import {
  notifyDealerApproved,
  notifyDealerRejected,
} from "@/lib/whatsapp";
import type { Capability, UserProfile, UserRole } from "@/lib/types";
import { tombsFromDb, userBeatsTomb } from "@/lib/user-tombs";

type PeopleTab = "dealers" | "staff" | "jobs" | "tools" | "log";
type DealerFilter = "all" | "pending" | "approved" | "revoked";

const STAFF_ROLES: UserRole[] = [
  "sales",
  "accounts",
  "dispatch",
  "plant_manager",
  "viewer",
  "super_admin",
];

function dealerFileStatus(u: UserProfile): Exclude<DealerFilter, "all"> {
  if (!u.active) return "revoked";
  if (u.approved) return "approved";
  return "pending";
}

export default function AdminUsersPage() {
  const t = useTranslations();
  const locale = useLocale() as "en" | "hi";
  const { db, refresh } = useDb();
  const { session } = useSession();
  const [tab, setTab] = useState<PeopleTab>("dealers");
  const [createBusy, setCreateBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [pulling, setPulling] = useState(false);
  const [cloudPending, setCloudPending] = useState<UserProfile[]>([]);
  const [reviewBusyId, setReviewBusyId] = useState<string | null>(null);
  const [resetBusyId, setResetBusyId] = useState<string | null>(null);

  useEffect(() => {
    const onSyncErr = (ev: Event) => {
      const detail = (ev as CustomEvent<string>).detail;
      if (detail) setMsg(detail);
    };
    window.addEventListener("tt-sync-error", onSyncErr);
    return () => window.removeEventListener("tt-sync-error", onSyncErr);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const loadPending = async (showSpinner: boolean) => {
      if (showSpinner) setPulling(true);
      try {
        const res = await fetch("/api/account/pending-dealers", {
          credentials: "include",
          cache: "no-store",
        });
        const data = (await res.json()) as {
          error?: string;
          users?: Array<{
            id: string;
            name: string;
            phone: string;
            company?: string;
            address?: string;
            pincode?: string;
            locale?: "en" | "hi";
            createdAt: string;
          }>;
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
        if (cancelled) return;
        if (!res.ok) {
          if (showSpinner && data.error) setMsg(data.error);
          return;
        }
        setCloudPending(
          (data.users ?? []).map((u) => ({
            id: u.id,
            passwordHash: "",
            name: u.name,
            phone: u.phone,
            company: u.company,
            address: u.address,
            pincode: u.pincode,
            locale: u.locale === "hi" ? "hi" : "en",
            walletBalance: 0,
            assignedSchemeIds: [],
            liftingProgressKg: 0,
            schemeProgress: {},
            active: true,
            approved: false,
            createdAt: u.createdAt,
            role: "customer" as const,
          }))
        );
        const { mergeCloudCustomerDirectory } = await import("@/lib/store/db");
        if (mergeCloudCustomerDirectory(data.dealers ?? [])) refresh();
      } catch {
        /* poll still runs */
      } finally {
        if (!cancelled && showSpinner) setPulling(false);
      }
    };
    void loadPending(true);
    const timer = window.setInterval(() => void loadPending(false), 5000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  if (
    session &&
    !checkCapability(session, db, "manage_users") &&
    tab !== "dealers"
  ) {
    setTab("dealers");
  }

  const [form, setForm] = useState({
    name: "",
    phone: "",
    password: "",
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
  const [dealerSearch, setDealerSearch] = useState("");
  const [dealerFilter, setDealerFilter] = useState<DealerFilter>("all");
  const [selectedDealers, setSelectedDealers] = useState<Set<string>>(
    new Set()
  );
  const [dealerEdit, setDealerEdit] = useState({
    name: "",
    phone: "",
    company: "",
    address: "",
    pincode: "",
    gstOrAadhar: "",
    transport: "",
    creditLimit: "" as number | "",
  });
  const toggleReveal = (id: string) => {
    setRevealed((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const viewingUser = useMemo(
    () =>
      (db?.users ?? []).find((u) => u.id === viewUserId) ??
      cloudPending.find((u) => u.id === viewUserId) ??
      null,
    [db, viewUserId, cloudPending]
  );

  const viewingParty = useMemo(() => {
    if (!viewingUser || viewingUser.role !== "customer") return null;
    return (
      (db?.parties ?? []).find(
        (p) => p.linkedUserId === viewingUser.id && p.type === "customer"
      ) ?? null
    );
  }, [db, viewingUser]);

  const [syncedDealer, setSyncedDealer] = useState({
    user: viewingUser,
    party: viewingParty,
  });
  if (viewingUser !== syncedDealer.user || viewingParty !== syncedDealer.party) {
    setSyncedDealer({ user: viewingUser, party: viewingParty });
    if (viewingUser && viewingUser.role === "customer") {
      setDealerEdit({
        name: viewingUser.name || "",
        phone: viewingUser.phone || "",
        company: viewingUser.company || "",
        address: viewingUser.address || "",
        pincode: viewingUser.pincode || "",
        gstOrAadhar: viewingUser.gstOrAadhar || "",
        transport: viewingUser.transport || "",
        creditLimit:
          viewingParty?.creditLimit && viewingParty.creditLimit > 0
            ? viewingParty.creditLimit
            : "",
      });
    }
  }

  const capCtx = capabilityContextFrom(db);

  const viewingHistory = useMemo(
    () => (viewUserId ? getUserHistorySummary(viewUserId) : null),
    // `db` is read inside getUserHistorySummary — recompute after each sync
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [viewUserId, db]
  );

  const pending = useMemo(() => {
    const tombs = tombsFromDb(db ?? {});
    const byId = new Map<string, UserProfile>();
    for (const u of db?.users ?? []) {
      if (
        u.role === "customer" &&
        u.approved !== true &&
        u.active !== false &&
        userBeatsTomb(u, tombs)
      ) {
        byId.set(u.id, u);
      }
    }
    for (const u of cloudPending) {
      if (userBeatsTomb(u, tombs)) byId.set(u.id, u);
    }
    return [...byId.values()].sort((a, b) =>
      (b.createdAt || "").localeCompare(a.createdAt || "")
    );
  }, [db, cloudPending]);

  const dealers = useMemo(() => {
    const tombs = tombsFromDb(db ?? {});
    const byId = new Map<string, UserProfile>();
    for (const u of db?.users ?? []) {
      if (u.role === "customer" && userBeatsTomb(u, tombs)) byId.set(u.id, u);
    }
    for (const u of cloudPending) {
      if (!byId.has(u.id) && userBeatsTomb(u, tombs)) byId.set(u.id, u);
    }
    return [...byId.values()];
  }, [db, cloudPending]);

  const staff = useMemo(
    () => (db?.users ?? []).filter((u) => u.role !== "customer"),
    [db]
  );

  const passwordRequests = useMemo(() => {
    const tombs = tombsFromDb(db ?? {});
    return (db?.users ?? [])
      .filter(
        (u) =>
          Boolean(u.passwordResetRequestedAt) && userBeatsTomb(u, tombs)
      )
      .sort((a, b) =>
        String(b.passwordResetRequestedAt || "").localeCompare(
          String(a.passwordResetRequestedAt || "")
        )
      );
  }, [db]);

  const visibleDealers = useMemo(() => {
    const q = dealerSearch.trim().toLowerCase();
    return dealers.filter((u) => {
      if (
        dealerFilter !== "all" &&
        dealerFileStatus(u) !== dealerFilter
      ) {
        return false;
      }
      if (!q) return true;
      return [u.name, u.phone, u.company, u.gstOrAadhar, u.address]
        .some((s) => (s || "").toLowerCase().includes(q));
    });
  }, [dealers, dealerSearch, dealerFilter]);

  const onCreate = async (e: FormEvent) => {
    e.preventDefault();
    if (createBusy) return;
    if (!session || session.role !== "super_admin") {
      setMsg(t("admin.peopleStaffOnlyOwner"));
      return;
    }
    if (!form.password.trim() || form.password.trim().length < 6) {
      setMsg(t("admin.peoplePasswordMin"));
      return;
    }
    setCreateBusy(true);
    try {
      const overrides = capabilityOverridesFromChecked(
        form.role,
        form.caps,
        db?.rolePresets
      );
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
        password: "",
        role: "sales",
        caps: rolePresetCapabilities("sales", db?.rolePresets),
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

  const promptResetPassword = async (userId: string, name: string) => {
    if (!session || resetBusyId) return;
    const next = window.prompt(
      t("admin.peopleNewPassword", { name }),
      ""
    );
    if (next === null) return;
    setResetBusyId(userId);
    try {
      const visible = await setUserPasswordAsync(userId, next, session.id);
      setMsg(
        locale === "hi"
          ? `${name} का पासवर्ड बदल दिया — नया: ${visible}`
          : `${name}'s password reset — new: ${visible}`
      );
      setRevealed((cur) => new Set(cur).add(userId));
      refresh();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Reset failed");
    } finally {
      setResetBusyId(null);
    }
  };

  if (
    !session ||
    (!checkCapability(session, db, "manage_users") &&
      !checkCapability(session, db, "approve_dealers"))
  ) {
    return (
      <AdminShell>
        <AdminAccessDenied />
      </AdminShell>
    );
  }

  const isOwner = session.role === "super_admin";
  const canManageStaff = checkCapability(session, db, "manage_users");
  const canManageDealerFile = checkCapability(session, db, "approve_dealers");
  const permEditUser =
    (db?.users ?? []).find((u) => u.id === permEditId) ?? null;

  const pingDealerRejected = (u: UserProfile) => {
    if (db) {
      void notifyDealerRejected({ user: u, settings: db.settings });
    }
  };

  const reviewDealerCloud = async (
    u: UserProfile,
    action: "approve" | "reject"
  ) => {
    if (reviewBusyId) return;
    setReviewBusyId(u.id);
    try {
      const res = await fetch("/api/account/pending-dealers", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: u.id, action }),
      });
      const data = (await res.json()) as {
        error?: string;
        users?: UserProfile[];
        waSent?: boolean;
      };
      if (!res.ok) {
        setMsg(data.error || "Could not update dealer");
        return;
      }
      setCloudPending((cur) => cur.filter((x) => x.id !== u.id));
      const waNote =
        data.waSent === true
          ? locale === "hi"
            ? " · WhatsApp भेजा"
            : " · WhatsApp sent"
          : locale === "hi"
            ? " · WhatsApp नहीं गया"
            : " · WhatsApp not sent";
      setMsg(
        (locale === "hi"
          ? action === "approve"
            ? `${u.name} अप्रूव हो गया`
            : `${u.name} अस्वीकृत`
          : action === "approve"
            ? `${u.name} approved`
            : `${u.name} rejected`) + waNote
      );
      if (action === "approve") {
        void notifyUserPush({
          userId: u.id,
          title: u.locale === "hi" ? "अकाउंट मंज़ूर" : "Account approved",
          body:
            u.locale === "hi"
              ? "अब आप लॉगिन करके ऑर्डर कर सकते हैं"
              : "You can now login and place orders",
          url: `/${u.locale === "hi" ? "hi" : "en"}/catalog`,
        });
        if (!data.waSent && db) {
          void notifyDealerApproved({ user: u, settings: db.settings });
        }
      } else if (!data.waSent) {
        pingDealerRejected(u);
      }
      try {
        const m = await import("@/lib/supabase/sync");
        const { loadDb, replaceDbFromCloud } = await import("@/lib/store/db");
        const remote = await m.pullCloudDatabase(loadDb());
        if (remote) replaceDbFromCloud(remote);
      } catch {
        /* list already updated from cloud */
      }
      refresh();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Could not update dealer");
    } finally {
      setReviewBusyId(null);
    }
  };

  const saveDealerFile = async () => {
    if (!session || !viewingUser || viewingUser.role !== "customer") return;
    if (reviewBusyId) return;
    setReviewBusyId(viewingUser.id);
    try {
      const res = await fetch("/api/account/pending-dealers", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: viewingUser.id,
          action: "update",
          patch: {
            name: dealerEdit.name,
            phone: dealerEdit.phone,
            company: dealerEdit.company,
            address: dealerEdit.address,
            pincode: dealerEdit.pincode,
            gstOrAadhar: dealerEdit.gstOrAadhar,
            transport: dealerEdit.transport,
            creditLimit:
              dealerEdit.creditLimit === ""
                ? null
                : Number(dealerEdit.creditLimit),
          },
        }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setMsg(data.error || t("admin.peopleDealerSaved"));
        return;
      }
      setMsg(t("admin.peopleDealerSaved"));
      try {
        const m = await import("@/lib/supabase/sync");
        const { loadDb, replaceDbFromCloud } = await import("@/lib/store/db");
        const remote = await m.pullCloudDatabase(loadDb());
        if (remote) replaceDbFromCloud(remote);
      } catch {
        /* poll still runs */
      }
      refresh();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : t("admin.peopleDealerSaved"));
    } finally {
      setReviewBusyId(null);
    }
  };

  const bulkReviewDealers = async (
    ids: string[],
    action: "approve" | "reject"
  ) => {
    if (!ids.length || reviewBusyId) {
      if (!ids.length) setMsg(t("admin.peopleBulkNone"));
      return;
    }
    setReviewBusyId("bulk");
    try {
      const res = await fetch("/api/account/pending-dealers", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userIds: ids, action }),
      });
      const data = (await res.json()) as {
        error?: string;
        waSent?: boolean;
        count?: number;
      };
      if (!res.ok) {
        setMsg(data.error || "Could not update dealer");
        return;
      }
      const idSet = new Set(ids);
      setCloudPending((cur) => cur.filter((x) => !idSet.has(x.id)));
      setSelectedDealers(new Set());
      setMsg(
        action === "approve"
          ? t("admin.peopleBulkApproveDone", { n: data.count ?? ids.length })
          : t("admin.peopleBulkRevokeDone", { n: data.count ?? ids.length })
      );
      try {
        const m = await import("@/lib/supabase/sync");
        const { loadDb, replaceDbFromCloud } = await import("@/lib/store/db");
        const remote = await m.pullCloudDatabase(loadDb());
        if (remote) replaceDbFromCloud(remote);
      } catch {
        /* list already updated from cloud */
      }
      refresh();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Could not update dealer");
    } finally {
      setReviewBusyId(null);
    }
  };

  const bulkRevokeSelected = async () => {
    const ids = [...selectedDealers].filter((id) => {
      const u = dealers.find((d) => d.id === id);
      return !!u?.active;
    });
    if (!ids.length) {
      setMsg(t("admin.peopleBulkNone"));
      return;
    }
    const reason = window.prompt(t("admin.peopleRevokeReason"), "");
    if (reason === null) return;
    if (reviewBusyId) return;
    setReviewBusyId("bulk");
    try {
      const res = await fetch("/api/account/pending-dealers", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userIds: ids, action: "revoke", reason }),
      });
      const data = (await res.json()) as { error?: string; count?: number };
      if (!res.ok) {
        setMsg(data.error || "Could not update dealer");
        return;
      }
      setSelectedDealers(new Set());
      setMsg(t("admin.peopleBulkRevokeDone", { n: data.count ?? ids.length }));
      try {
        const m = await import("@/lib/supabase/sync");
        const { loadDb, replaceDbFromCloud } = await import("@/lib/store/db");
        const remote = await m.pullCloudDatabase(loadDb());
        if (remote) replaceDbFromCloud(remote);
      } catch {
        /* poll */
      }
      refresh();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Could not update dealer");
    } finally {
      setReviewBusyId(null);
    }
  };

  const bulkRestoreSelected = async () => {
    const ids = [...selectedDealers].filter((id) => {
      const u = dealers.find((d) => d.id === id);
      return !!u && !u.active;
    });
    if (!ids.length) {
      setMsg(t("admin.peopleBulkNone"));
      return;
    }
    if (reviewBusyId) return;
    setReviewBusyId("bulk");
    try {
      const res = await fetch("/api/account/pending-dealers", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userIds: ids, action: "restore" }),
      });
      const data = (await res.json()) as { error?: string; count?: number };
      if (!res.ok) {
        setMsg(data.error || "Could not update dealer");
        return;
      }
      setSelectedDealers(new Set());
      setMsg(t("admin.peopleBulkRestoreDone", { n: data.count ?? ids.length }));
      try {
        const m = await import("@/lib/supabase/sync");
        const { loadDb, replaceDbFromCloud } = await import("@/lib/store/db");
        const remote = await m.pullCloudDatabase(loadDb());
        if (remote) replaceDbFromCloud(remote);
      } catch {
        /* poll */
      }
      refresh();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Could not update dealer");
    } finally {
      setReviewBusyId(null);
    }
  };

  const renderPasswordCell = (u: {
    id: string;
    passwordVisible?: string;
    passwordResetRequestedAt?: string;
    name: string;
  }) => {
    const shown = revealed.has(u.id);
    const requested = Boolean(u.passwordResetRequestedAt);
    return (
      <div className="flex flex-wrap items-center gap-1.5">
        {requested ? (
          <span className="rounded bg-sky-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-sky-900">
            {t("admin.peoplePasswordRequest")}
          </span>
        ) : null}
        {u.passwordVisible ? (
          <>
            <code className="rounded bg-[var(--surface-2)] px-1.5 py-0.5 font-mono text-xs">
              {shown ? u.passwordVisible : "••••••••"}
            </code>
            <button
              type="button"
              className="text-xs font-semibold text-[var(--brand)] underline underline-offset-2"
              onClick={() => toggleReveal(u.id)}
            >
              {shown ? t("admin.peopleHide") : t("admin.peopleShow")}
            </button>
            {shown ? (
              <button
                type="button"
                className="text-xs font-semibold text-[var(--ink-muted)] underline underline-offset-2"
                onClick={() => {
                  void navigator.clipboard?.writeText(u.passwordVisible || "");
                  setMsg(t("admin.peopleCopy"));
                }}
              >
                {t("admin.peopleCopyBtn")}
              </button>
            ) : null}
          </>
        ) : (
          <span className="text-xs text-[var(--ink-muted)]">
            {t("admin.peopleHiddenPassword")}
          </span>
        )}
        <button
          type="button"
          className="text-xs font-semibold text-[var(--brand)] underline underline-offset-2"
          disabled={resetBusyId === u.id}
          onClick={() => void promptResetPassword(u.id, u.name)}
        >
          {t("admin.peopleReset")}
        </button>
      </div>
    );
  };

  const promptRevoke = async (userId: string, name: string) => {
    if (!session) return;
    const target =
      (db?.users ?? []).find((u) => u.id === userId) ??
      dealers.find((u) => u.id === userId);
    const reason = window.prompt(t("admin.peopleRevokeReason"), "");
    if (reason === null) return;
    if (target?.role === "customer" || !target) {
      if (reviewBusyId) return;
      setReviewBusyId(userId);
      try {
        const res = await fetch("/api/account/pending-dealers", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId, action: "revoke", reason }),
        });
        const data = (await res.json()) as { error?: string };
        if (!res.ok) {
          setMsg(data.error || "Revoke failed");
          return;
        }
        setMsg(t("admin.peopleAccessRevoked", { name }));
        try {
          const m = await import("@/lib/supabase/sync");
          const { loadDb, replaceDbFromCloud } = await import("@/lib/store/db");
          const remote = await m.pullCloudDatabase(loadDb());
          if (remote) replaceDbFromCloud(remote);
        } catch {
          /* poll */
        }
        refresh();
      } catch (err) {
        setMsg(err instanceof Error ? err.message : "Revoke failed");
      } finally {
        setReviewBusyId(null);
      }
      return;
    }
    try {
      revokeUserAccess(userId, session.id, reason);
      setMsg(t("admin.peopleAccessRevoked", { name }));
      refresh();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Revoke failed");
    }
  };

  const doRestore = async (userId: string, name: string) => {
    if (!session) return;
    const target =
      (db?.users ?? []).find((u) => u.id === userId) ??
      dealers.find((u) => u.id === userId);
    if (target?.role === "customer" || !target) {
      if (reviewBusyId) return;
      setReviewBusyId(userId);
      try {
        const res = await fetch("/api/account/pending-dealers", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId, action: "restore" }),
        });
        const data = (await res.json()) as { error?: string };
        if (!res.ok) {
          setMsg(data.error || "Restore failed");
          return;
        }
        setMsg(t("admin.peopleAccessRestored", { name }));
        try {
          const m = await import("@/lib/supabase/sync");
          const { loadDb, replaceDbFromCloud } = await import("@/lib/store/db");
          const remote = await m.pullCloudDatabase(loadDb());
          if (remote) replaceDbFromCloud(remote);
        } catch {
          /* poll */
        }
        refresh();
      } catch (err) {
        setMsg(err instanceof Error ? err.message : "Restore failed");
      } finally {
        setReviewBusyId(null);
      }
      return;
    }
    try {
      restoreUserAccess(userId, session.id);
      setMsg(t("admin.peopleAccessRestored", { name }));
      refresh();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Restore failed");
    }
  };

  const canDeposit =
    canManageStaff &&
    !!session &&
    checkCapability(session, db, "manage_wallet");

  const promptDeposit = (userId: string, name: string) => {
    if (!session || !canDeposit) {
      window.alert(t("admin.peopleNoWalletPerm"));
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
      window.alert(t("admin.peoplePositiveAmount"));
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
      setMsg(t("admin.peopleDeposited", { amount: formatInr(amount), name }));
      refresh();
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "Deposit failed");
      setMsg(err instanceof Error ? err.message : "Deposit failed");
    }
  };

  const promptDelete = async (userId: string, name: string) => {
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
      await deleteUserAccountAndSync(userId, session.id, { force: true });
      if (viewUserId === userId) setViewUserId(null);
      setCloudPending((p) => p.filter((u) => u.id !== userId));
      setMsg(t("admin.peopleDeleted", { name }));
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
        value: staffRoleLabel(u.role, locale),
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
        label: t("checkout.gstAadhar"),
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
    if (u.passwordResetRequestedAt) {
      rows.push({
        label: t("admin.peoplePasswordRequests"),
        value: new Date(u.passwordResetRequestedAt).toLocaleString(
          locale === "hi" ? "hi-IN" : "en-IN"
        ),
      });
    }
    if (u.passwordVisible && canManageStaff) {
      rows.push({
        label: locale === "hi" ? "पासवर्ड" : "Password",
        value: u.passwordVisible,
      });
    }
    return rows;
  };

  const tabs: { key: PeopleTab; label: string }[] = [
    { key: "dealers", label: t("admin.tabDealers") },
    ...(canManageStaff
      ? [
          { key: "staff" as const, label: t("admin.tabStaff") },
          { key: "jobs" as const, label: t("admin.tabJobs") },
          { key: "tools" as const, label: t("admin.tabTools") },
          { key: "log" as const, label: t("admin.tabPeopleLog") },
        ]
      : []),
  ];

  return (
    <AdminShell>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{t("admin.users")}</h1>
          <p className="mt-1 text-sm text-[var(--ink-muted)]">
            {canManageStaff
              ? t("admin.usersHint")
              : t("admin.usersHintDealers")}
            {pulling ? ` · ${t("admin.peopleRefreshing")}` : ""}
          </p>
        </div>
        {tab === "staff" && canManageStaff ? (
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
        {tab === "jobs" && isOwner ? (
          <button
            type="button"
            className="tt-btn tt-btn-dark"
            onClick={() => {
              document.getElementById("create-job-form")?.scrollIntoView({
                behavior: "smooth",
              });
            }}
          >
            {t("admin.peopleNewJob")}
          </button>
        ) : null}
        {tab === "dealers" && canManageStaff ? (
          <button
            type="button"
            className="tt-btn tt-btn-dark"
            onClick={() => {
              document
                .getElementById("create-dealer-form")
                ?.scrollIntoView({ behavior: "smooth" });
            }}
          >
            {t("admin.peopleCreateDealer")}
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
                {viewingUser.role === "customer" && canManageDealerFile
                  ? t("admin.peopleEditDealer")
                  : t("admin.peopleUserInfo")}
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
              {t("admin.peopleClose")}
            </button>
          </div>
          {viewingUser.role === "customer" && canManageDealerFile ? (
            <form
              className="grid gap-3 sm:grid-cols-2"
              onSubmit={(e) => {
                e.preventDefault();
                void saveDealerFile();
              }}
            >
              <input
                className="tt-input"
                placeholder={t("common.name")}
                value={dealerEdit.name}
                onChange={(e) =>
                  setDealerEdit({ ...dealerEdit, name: e.target.value })
                }
                required
              />
              <input
                className="tt-input"
                type="tel"
                placeholder={t("common.phone")}
                value={dealerEdit.phone}
                onChange={(e) =>
                  setDealerEdit({ ...dealerEdit, phone: e.target.value })
                }
                required
              />
              <input
                className="tt-input"
                placeholder={t("admin.peopleCompany")}
                value={dealerEdit.company}
                onChange={(e) =>
                  setDealerEdit({ ...dealerEdit, company: e.target.value })
                }
              />
              <input
                className="tt-input"
                placeholder={t("admin.peopleGst")}
                value={dealerEdit.gstOrAadhar}
                onChange={(e) =>
                  setDealerEdit({ ...dealerEdit, gstOrAadhar: e.target.value })
                }
              />
              <input
                className="tt-input sm:col-span-2"
                placeholder={t("admin.peopleAddress")}
                value={dealerEdit.address}
                onChange={(e) =>
                  setDealerEdit({ ...dealerEdit, address: e.target.value })
                }
              />
              <input
                className="tt-input"
                placeholder={t("admin.peoplePincode")}
                value={dealerEdit.pincode}
                onChange={(e) =>
                  setDealerEdit({ ...dealerEdit, pincode: e.target.value })
                }
              />
              <NumberField
                className="tt-input"
                min={0}
                step="1"
                emptyAs={null}
                placeholder={t("admin.peopleCreditLimit")}
                value={dealerEdit.creditLimit}
                onValueChange={(v) =>
                  setDealerEdit({
                    ...dealerEdit,
                    creditLimit: typeof v === "number" ? v : "",
                  })
                }
              />
              <TransportInput
                className="tt-input sm:col-span-2"
                placeholder={t("admin.peopleTransport")}
                value={dealerEdit.transport}
                onChange={(transport) =>
                  setDealerEdit({ ...dealerEdit, transport })
                }
              />
              <div className="sm:col-span-2">
                <button type="submit" className="tt-btn tt-btn-dark" disabled={!!reviewBusyId}>
                  {t("admin.peopleSaveDealer")}
                </button>
              </div>
            </form>
          ) : (
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
          )}
          {viewingHistory ? (
            <div className="rounded-xl bg-[var(--surface-2)] px-3 py-2 text-xs text-[var(--ink)]">
              {t("admin.peopleHistory", {
                orders: viewingHistory.orders,
                wallet: viewingHistory.walletTxs,
                vouchers: viewingHistory.vouchers,
              })}
              {!viewingHistory.canHardDelete ? (
                <span className="ml-2 text-[var(--danger)]">
                  {t("admin.peopleForceDeleteNote")}
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
                    {t("admin.peopleDepositWallet")}
                  </button>
                ) : null}
                {canManageDealerFile ? (
                  <>
                {viewingUser.active ? (
                  <button
                    type="button"
                    className="tt-btn tt-btn-outline text-[var(--danger)]"
                    disabled={reviewBusyId === viewingUser.id}
                    onClick={() => void promptRevoke(viewingUser.id, viewingUser.name)}
                  >
                    {t("admin.peopleRevoke")}
                  </button>
                ) : (
                  <button
                    type="button"
                    className="tt-btn tt-btn-outline"
                    disabled={reviewBusyId === viewingUser.id}
                    onClick={() => void doRestore(viewingUser.id, viewingUser.name)}
                  >
                    {t("admin.peopleRestore")}
                  </button>
                )}
                  </>
                ) : null}
                {canManageStaff ? (
                <button
                  type="button"
                  className="tt-btn tt-btn-outline text-[var(--danger)]"
                  onClick={() => promptDelete(viewingUser.id, viewingUser.name)}
                >
                  {t("admin.peopleForceDelete")}
                </button>
                ) : null}
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

      {canManageStaff && passwordRequests.length ? (
        <div className="mt-5 rounded-2xl border border-sky-300 bg-sky-50 p-5">
          <h2 className="font-semibold text-sky-950">
            {t("admin.peoplePasswordRequests")} ({passwordRequests.length})
          </h2>
          <p className="mt-1 text-sm text-sky-900">
            {t("admin.peoplePasswordRequestHint")}
          </p>
          <ul className="mt-4 space-y-3">
            {passwordRequests.map((u) => (
              <li
                key={u.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-white px-4 py-3 text-sm"
              >
                <div>
                  <p className="font-semibold">{u.name}</p>
                  <p className="text-[var(--ink-muted)]">
                    {u.phone}
                    {u.company ? ` · ${u.company}` : ""}
                    {u.role !== "customer" ? ` · ${u.role}` : ""}
                  </p>
                  {u.passwordResetRequestedAt ? (
                    <p className="mt-0.5 text-xs text-sky-800">
                      {t("admin.peoplePasswordRequestedAt", {
                        when: new Date(
                          u.passwordResetRequestedAt
                        ).toLocaleString(locale === "hi" ? "hi-IN" : "en-IN"),
                      })}
                    </p>
                  ) : null}
                </div>
                <button
                  type="button"
                  className="tt-btn tt-btn-dark"
                  disabled={resetBusyId === u.id}
                  onClick={() => void promptResetPassword(u.id, u.name)}
                >
                  {t("admin.peopleReset")}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

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
                        disabled={reviewBusyId === u.id}
                        onClick={() => void reviewDealerCloud(u, "approve")}
                      >
                        {t("admin.approve")}
                      </button>
                      <button
                        type="button"
                        className="tt-btn tt-btn-outline text-[var(--danger)]"
                        disabled={reviewBusyId === u.id}
                        onClick={() => {
                          if (
                            !confirm(t("admin.peopleRejectConfirm"))
                          )
                            return;
                          void reviewDealerCloud(u, "reject");
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

          <div className="tt-panel mt-5 space-y-3 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <input
                className="tt-input min-w-[220px] flex-1"
                placeholder={t("admin.peopleSearch")}
                value={dealerSearch}
                onChange={(e) => setDealerSearch(e.target.value)}
              />
              {(
                [
                  ["all", t("common.all")],
                  ["pending", t("admin.peopleFilterPending")],
                  ["approved", t("admin.peopleFilterApproved")],
                  ["revoked", t("admin.peopleFilterRevoked")],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setDealerFilter(key)}
                  className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${
                    dealerFilter === key
                      ? "tt-selected bg-[var(--brand-deep)] text-white"
                      : "border border-[var(--line)] bg-white text-[var(--ink-muted)]"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-[var(--ink-muted)]">
                {t("admin.peopleSelected", { n: selectedDealers.size })}
              </span>
              <button
                type="button"
                className="tt-btn tt-btn-dark"
                disabled={!!reviewBusyId}
                onClick={() =>
                  void bulkReviewDealers(
                    visibleDealers
                      .filter(
                        (u) =>
                          selectedDealers.has(u.id) &&
                          u.active &&
                          !u.approved
                      )
                      .map((u) => u.id),
                    "approve"
                  )
                }
              >
                {t("admin.peopleBulkApprove")}
              </button>
              {canManageDealerFile ? (
                <>
              <button
                type="button"
                className="tt-btn tt-btn-outline text-[var(--danger)]"
                disabled={!!reviewBusyId}
                onClick={() => void bulkRevokeSelected()}
              >
                {t("admin.peopleBulkRevoke")}
              </button>
              <button
                type="button"
                className="tt-btn tt-btn-outline"
                disabled={!!reviewBusyId}
                onClick={() => void bulkRestoreSelected()}
              >
                {t("admin.peopleBulkRestore")}
              </button>
                </>
              ) : null}
            </div>
          </div>

          <div className="tt-panel mt-5 overflow-x-auto">
            <table className="tt-table min-w-[1200px]">
              <thead>
                <tr>
                  <th>
                    <input
                      type="checkbox"
                      checked={
                        visibleDealers.length > 0 &&
                        visibleDealers.every((u) => selectedDealers.has(u.id))
                      }
                      onChange={(e) => {
                        if (e.target.checked) {
                          setSelectedDealers(
                            new Set(visibleDealers.map((u) => u.id))
                          );
                        } else {
                          setSelectedDealers(new Set());
                        }
                      }}
                    />
                  </th>
                  <th>{t("common.name")}</th>
                  <th>{t("common.phone")}</th>
                  <th>{t("common.status")}</th>
                  <th>{t("common.wallet")}</th>
                  <th>{t("admin.peopleLifting")}</th>
                  <th>{t("admin.peoplePassword")}</th>
                  <th>{t("common.actions")}</th>
                </tr>
              </thead>
              <tbody>
                {visibleDealers.map((u) => (
                  <tr key={u.id}>
                    <td>
                      <input
                        type="checkbox"
                        checked={selectedDealers.has(u.id)}
                        onChange={(e) => {
                          setSelectedDealers((cur) => {
                            const next = new Set(cur);
                            if (e.target.checked) next.add(u.id);
                            else next.delete(u.id);
                            return next;
                          });
                        }}
                      />
                    </td>
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
                          {t("admin.peopleRevoked")}
                        </span>
                      ) : u.approved ? (
                        <span className="text-xs font-semibold text-[var(--ok)]">
                          {t("admin.peopleApproved")}
                        </span>
                      ) : (
                        <div className="flex flex-wrap gap-1.5">
                          <button
                            type="button"
                            className="text-xs font-semibold text-[var(--brand)]"
                            disabled={reviewBusyId === u.id}
                            onClick={() => void reviewDealerCloud(u, "approve")}
                          >
                            {t("admin.approve")}
                          </button>
                          <button
                            type="button"
                            className="text-xs font-semibold text-[var(--danger)]"
                            disabled={reviewBusyId === u.id}
                            onClick={() => {
                              if (!confirm(t("admin.peopleRejectConfirm"))) {
                                return;
                              }
                              void reviewDealerCloud(u, "reject");
                            }}
                          >
                            {t("admin.reject")}
                          </button>
                        </div>
                      )}
                    </td>
                    <td>{formatInr(u.walletBalance)}</td>
                    <td>{u.liftingProgressKg}</td>
                    <td>{canManageStaff ? renderPasswordCell(u) : "—"}</td>
                    <td>
                      <div className="flex flex-wrap gap-1.5">
                        <button
                          type="button"
                          className="text-xs font-semibold text-[var(--brand)] underline underline-offset-2"
                          onClick={() => setViewUserId(u.id)}
                        >
                          {t("admin.peopleInfo")}
                        </button>
                        {canDeposit ? (
                          <button
                            type="button"
                            className="text-xs font-semibold text-[var(--ok)] underline underline-offset-2"
                            onClick={() => promptDeposit(u.id, u.name)}
                          >
                            {t("admin.peopleDeposit")}
                          </button>
                        ) : null}
                        {canManageDealerFile ? (
                          u.active ? (
                          <button
                            type="button"
                            className="text-xs font-semibold text-[var(--danger)] underline underline-offset-2"
                            disabled={reviewBusyId === u.id}
                            onClick={() => void promptRevoke(u.id, u.name)}
                          >
                            {t("admin.peopleRevoke")}
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="text-xs font-semibold text-[var(--ok)] underline underline-offset-2"
                            disabled={reviewBusyId === u.id}
                            onClick={() => void doRestore(u.id, u.name)}
                          >
                            {t("admin.peopleRestore")}
                          </button>
                        )
                        ) : null}
                        {canManageStaff ? (
                        <button
                          type="button"
                          className="text-xs font-semibold text-[var(--danger)] underline underline-offset-2"
                          onClick={() => promptDelete(u.id, u.name)}
                        >
                          {t("common.delete")}
                        </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!visibleDealers.length ? (
              <p className="p-6 text-sm text-[var(--ink-muted)]">
                {t("common.empty")}
              </p>
            ) : null}
          </div>

          {canManageStaff ? (
          <form
            id="create-dealer-form"
            onSubmit={onCreateDealer}
            className="tt-panel mt-5 space-y-3 p-5"
          >
            <div className="flex flex-wrap items-end justify-between gap-2">
              <div>
                <h2 className="font-semibold">
                  {t("admin.peopleCreateDealer")}
                </h2>
                <p className="text-xs text-[var(--ink-muted)]">
                  {t("admin.peopleCreateDealerHint")}
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
                placeholder={t("admin.peoplePassword")}
                value={dealerForm.password}
                onChange={(e) =>
                  setDealerForm({ ...dealerForm, password: e.target.value })
                }
                required
              />
              <input
                className="tt-input"
                placeholder={t("admin.peopleCompany")}
                value={dealerForm.company}
                onChange={(e) =>
                  setDealerForm({ ...dealerForm, company: e.target.value })
                }
              />
              <input
                className="tt-input sm:col-span-2"
                placeholder={t("admin.peopleAddress")}
                value={dealerForm.address}
                onChange={(e) =>
                  setDealerForm({ ...dealerForm, address: e.target.value })
                }
              />
              <input
                className="tt-input"
                placeholder={t("admin.peoplePincode")}
                value={dealerForm.pincode}
                onChange={(e) =>
                  setDealerForm({ ...dealerForm, pincode: e.target.value })
                }
              />
              <input
                className="tt-input"
                placeholder={t("admin.peopleGst")}
                value={dealerForm.gstOrAadhar}
                onChange={(e) =>
                  setDealerForm({ ...dealerForm, gstOrAadhar: e.target.value })
                }
              />
              <TransportInput
                className="tt-input sm:col-span-2"
                placeholder={t("admin.peopleTransport")}
                value={dealerForm.transport}
                onChange={(transport) =>
                  setDealerForm({ ...dealerForm, transport })
                }
              />
            </div>
            <button type="submit" className="tt-btn tt-btn-dark">
              {t("admin.peopleCreateDealer")}
            </button>
          </form>
          ) : null}
        </>
      ) : null}

      {tab === "staff" && canManageStaff ? (
        <>
          <p className="mt-4 text-sm text-[var(--ink-muted)]">
            {t("admin.ownersNote")}
          </p>
          {permEditUser && permEditUser.role !== "customer" && isOwner ? (
            <div className="tt-panel mt-4 space-y-3 p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="font-semibold">
                  {t("admin.peopleCustomize")} — {permEditUser.name}
                </h2>
                <button
                  type="button"
                  className="tt-btn tt-btn-outline"
                  onClick={() => setPermEditId(null)}
                >
                  {t("admin.peopleClose")}
                </button>
              </div>
              <p className="text-xs text-[var(--ink-muted)]">
                {t("admin.peopleCustomizeHint")}
              </p>
              <StaffPermissionsPanel
                role={permEditUser.role}
                checked={effectiveCapabilities(permEditUser, capCtx)}
                locale={locale}
                presets={db?.rolePresets}
                onChange={(caps) => {
                  const overrides = capabilityOverridesFromChecked(
                    permEditUser.role,
                    caps,
                    db?.rolePresets
                  );
                  upsertUser({
                    ...permEditUser,
                    jobId: undefined,
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
                  <th>{t("admin.peopleRole")}</th>
                  <th>{t("admin.peopleJob")}</th>
                  <th>{t("common.status")}</th>
                  <th>{t("admin.peoplePassword")}</th>
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
                            ({t("admin.peopleYou")})
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
                              setMsg(t("admin.peopleLastOwnerDemote"));
                              return;
                            }
                            upsertUser({
                              ...u,
                              role: nextRole,
                              extraCapabilities: undefined,
                              deniedCapabilities: undefined,
                              jobId: undefined,
                            });
                            refresh();
                          }}
                        >
                          {STAFF_ROLES.map((r) => (
                            <option key={r} value={r}>
                              {staffRoleLabel(r, locale)}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        {u.role === "super_admin" ? (
                          <span className="text-xs text-[var(--ink-muted)]">
                            —
                          </span>
                        ) : (
                          <select
                            className="tt-select"
                            value={u.jobId || ""}
                            disabled={locked || !isOwner}
                            onChange={(e) => {
                              try {
                                assignStaffJob(
                                  u.id,
                                  e.target.value || null,
                                  session.id
                                );
                                setMsg(t("admin.peopleJobAssigned"));
                                refresh();
                              } catch (err) {
                                setMsg(
                                  err instanceof Error
                                    ? err.message
                                    : t("admin.peopleJobAssigned")
                                );
                              }
                            }}
                          >
                            <option value="">{t("admin.peopleNoJob")}</option>
                            {(db?.staffJobs ?? []).map((job) => (
                              <option key={job.id} value={job.id}>
                                {staffJobLabel(job, locale)}
                              </option>
                            ))}
                          </select>
                        )}
                      </td>
                      <td>
                        {!u.active ? (
                          <span
                            className="text-xs font-semibold text-[var(--danger)]"
                            title={u.revokedReason || ""}
                          >
                            {t("admin.peopleRevoked")}
                          </span>
                        ) : (
                          <span className="text-xs font-semibold text-[var(--ok)]">
                            {t("admin.peopleActive")}
                          </span>
                        )}
                      </td>
                      <td>{renderPasswordCell(u)}</td>
                      <td>
                        {locked && u.role === "super_admin" && otherOwners === 0 ? (
                          <span className="text-xs text-[var(--ink-muted)]">
                            {t("admin.peopleProtected")}
                          </span>
                        ) : locked ? (
                          <span className="text-xs text-[var(--ink-muted)]">
                            {t("admin.peopleSelf")}
                          </span>
                        ) : (
                          <div className="flex flex-wrap gap-1.5">
                            <button
                              type="button"
                              className="text-xs font-semibold text-[var(--brand)] underline underline-offset-2"
                              onClick={() => setViewUserId(u.id)}
                            >
                              {t("admin.peopleInfo")}
                            </button>
                            {isOwner && u.role !== "super_admin" ? (
                              <button
                                type="button"
                                className="text-xs font-semibold text-[var(--brand)] underline underline-offset-2"
                                onClick={() => setPermEditId(u.id)}
                              >
                                {t("admin.peopleCustomize")}
                              </button>
                            ) : null}
                            {u.active ? (
                              <button
                                type="button"
                                className="text-xs font-semibold text-[var(--danger)] underline underline-offset-2"
                                onClick={() => promptRevoke(u.id, u.name)}
                              >
                                {t("admin.peopleRevoke")}
                              </button>
                            ) : (
                              <button
                                type="button"
                                className="text-xs font-semibold text-[var(--ok)] underline underline-offset-2"
                                onClick={() => doRestore(u.id, u.name)}
                              >
                                {t("admin.peopleRestore")}
                              </button>
                            )}
                            <button
                              type="button"
                              className="text-xs font-semibold text-[var(--danger)] underline underline-offset-2"
                              onClick={() => promptDelete(u.id, u.name)}
                            >
                              {t("common.delete")}
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
                  caps: rolePresetCapabilities(role, db?.rolePresets),
                });
              }}
            >
              {STAFF_ROLES.map((r) => (
                <option key={r} value={r}>
                  {staffRoleLabel(r, locale)}
                </option>
              ))}
            </select>
            {isOwner ? (
              <StaffPermissionsPanel
                role={form.role}
                checked={form.caps}
                locale={locale}
                presets={db?.rolePresets}
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

      {tab === "jobs" && canManageStaff ? (
        <PeopleJobsTab
          db={db}
          locale={locale}
          isOwner={isOwner}
          actorId={session.id}
          onMsg={setMsg}
          onRefresh={refresh}
        />
      ) : null}

      {tab === "tools" && canManageStaff ? (
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
              setMsg(t("admin.peopleWalletUpdated"));
              refresh();
            }}
          >
            <h2 className="font-semibold">
              {t("admin.peopleWalletDeposit")}
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
              placeholder={t("admin.peopleDepositAmount")}
              value={walletForm.amount || ""}
              onValueChange={(v) =>
                setWalletForm({
                  ...walletForm,
                  amount: typeof v === "number" ? v : 0,
                })
              }
            />
            <p className="text-xs text-[var(--ink-muted)]">
              {t("admin.peopleWalletHint")}
            </p>
            <input
              className="tt-input"
              value={walletForm.reason}
              onChange={(e) =>
                setWalletForm({ ...walletForm, reason: e.target.value })
              }
              placeholder={t("admin.peopleReason")}
            />
            <button type="submit" className="tt-btn tt-btn-dark">
              {t("admin.peopleDeposit")}
            </button>
          </form>

          {checkCapability(session, db, "manage_schemes") ? (
          <form
            className="tt-panel space-y-3 p-5"
            onSubmit={(e) => {
              e.preventDefault();
              if (!assignForm.userId || !assignForm.schemeId) return;
              assignSchemeToUser(assignForm.userId, assignForm.schemeId);
              setMsg(t("admin.peopleSchemeAssigned"));
              refresh();
            }}
          >
            <h2 className="font-semibold">{t("admin.peopleAssignScheme")}</h2>
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
              {t("admin.peopleAssign")}
            </button>
          </form>
          ) : (
            <div className="tt-panel space-y-2 p-5">
              <h2 className="font-semibold">{t("admin.peopleAssignScheme")}</h2>
              <p className="text-sm text-[var(--ink-muted)]">
                {t("admin.peopleNeedSchemes")}
              </p>
            </div>
          )}
        </div>
      ) : null}

      {tab === "log" && canManageStaff ? (
        <div className="tt-panel mt-5 overflow-x-auto">
          <div className="border-b border-[var(--line)] px-4 py-3">
            <h2 className="font-semibold">{t("admin.tabPeopleLog")}</h2>
            <p className="text-xs text-[var(--ink-muted)]">
              {t("admin.peopleLogHint")}
            </p>
          </div>
          <table className="tt-table min-w-[900px]">
            <thead>
              <tr>
                <th>{t("admin.peopleLogWhen")}</th>
                <th>{t("admin.peopleLogWho")}</th>
                <th>{t("admin.peopleLogAction")}</th>
                <th>{t("admin.tabDealers")}</th>
                <th>{t("admin.peopleLogDetail")}</th>
              </tr>
            </thead>
            <tbody>
              {(db?.peopleActivity ?? []).slice(0, 80).map((row) => {
                const actionLabel =
                  row.action === "approve"
                    ? t("admin.approve")
                    : row.action === "reject"
                      ? t("admin.reject")
                      : row.action === "revoke"
                        ? t("admin.peopleRevoke")
                        : row.action === "restore"
                          ? t("admin.peopleRestore")
                          : t("admin.peopleLogEdit");
                const detail = [
                  row.reason,
                  ...(row.changes ?? []).map(
                    (c) => `${c.field}: ${c.from || "—"} → ${c.to || "—"}`
                  ),
                ]
                  .filter(Boolean)
                  .join(" · ");
                return (
                  <tr key={row.id}>
                    <td className="whitespace-nowrap text-xs">
                      {new Date(row.at).toLocaleString(
                        locale === "hi" ? "hi-IN" : "en-IN"
                      )}
                    </td>
                    <td>{row.actorName}</td>
                    <td className="text-xs font-semibold">{actionLabel}</td>
                    <td>
                      <div className="font-medium">{row.userName}</div>
                      <div className="font-mono text-xs text-[var(--ink-muted)]">
                        {row.userPhone}
                      </div>
                    </td>
                    <td className="text-xs text-[var(--ink-muted)]">
                      {detail || "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!(db?.peopleActivity ?? []).length ? (
            <p className="p-6 text-sm text-[var(--ink-muted)]">
              {t("common.empty")}
            </p>
          ) : null}
        </div>
      ) : null}
    </AdminShell>
  );
}
