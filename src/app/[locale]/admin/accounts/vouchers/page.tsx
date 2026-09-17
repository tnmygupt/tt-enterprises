"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { useRouter } from "@/i18n/routing";
import { AdminAccessDenied } from "@/components/AdminAccessDenied";
import { AccountsShell } from "@/components/AccountsShell";
import { useDb, useSession } from "@/lib/hooks";
import { canViewFinancials, checkCapability } from "@/lib/store/db";
import type { VoucherType } from "@/lib/types";
import { VoucherForm } from "./VoucherForm";
import { VoucherList } from "./VoucherList";
import { VoucherView } from "./VoucherView";

const FORM_TYPES: VoucherType[] = [
  "sale",
  "purchase",
  "receipt",
  "payment",
  "journal",
  "credit_note",
  "debit_note",
];

function isVoucherType(v: string | null): v is VoucherType {
  return !!v && (FORM_TYPES as string[]).includes(v);
}

function isOwnerOnlyType(type: VoucherType): boolean {
  return type === "purchase" || type === "payment" || type === "debit_note";
}

function VouchersInner() {
  const t = useTranslations();
  const locale = useLocale() as "en" | "hi";
  const search = useSearchParams();
  const router = useRouter();
  const { session } = useSession();
  const { db, refresh } = useDb();
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");

  const rawNew = search.get("new");
  const formType = isVoucherType(rawNew) ? rawNew : null;
  const viewId = search.get("id");
  const partyPrefill = search.get("party") || "";
  const listQ = search.get("q") || "";

  useEffect(() => {
    if (formType === "journal") {
      router.replace("/admin/accounts/journal");
    }
  }, [formType, router]);

  const viewing = useMemo(
    () =>
      viewId && db ? db.vouchers.find((v) => v.id === viewId) || null : null,
    [db, viewId]
  );

  if (!session || !checkCapability(session, db, "manage_accounts")) {
    return <AdminAccessDenied />;
  }

  const showPurchaseRates = canViewFinancials(session.role);

  const goList = () => {
    router.replace("/admin/accounts/vouchers");
  };

  const openForm = (type: VoucherType) => {
    if (isOwnerOnlyType(type) && !showPurchaseRates) {
      setError(t("accounts.ownerOnlyPurchasePay"));
      return;
    }
    setError("");
    setMsg("");
    router.replace(`/admin/accounts/vouchers?new=${type}`);
  };

  const openView = (id: string) => {
    setError("");
    router.replace(`/admin/accounts/vouchers?id=${encodeURIComponent(id)}`);
  };

  if (formType === "journal") {
    return <p className="mt-5 text-sm">{t("common.loading")}</p>;
  }

  if (formType && isOwnerOnlyType(formType) && !showPurchaseRates) {
    return (
      <div className="tt-panel mt-5 p-5">
        <p className="text-sm text-[var(--danger)]">
          {t("accounts.ownerOnlyPurchasePay")}
        </p>
        <button type="button" className="tt-btn tt-btn-outline mt-3" onClick={goList}>
          {t("common.cancel")}
        </button>
      </div>
    );
  }

  return (
    <>
      {msg ? <p className="mt-3 text-sm text-[var(--ok)]">{msg}</p> : null}
      {error && !formType ? (
        <p className="mt-3 text-sm text-[var(--danger)]">{error}</p>
      ) : null}

      {formType ? (
        <VoucherForm
          type={formType}
          initialPartyId={partyPrefill}
          onCancel={goList}
          onSaved={(m) => {
            setMsg(m);
            refresh();
            goList();
          }}
        />
      ) : viewing && db ? (
        <VoucherView
          voucher={viewing}
          db={db}
          locale={locale}
          showPurchaseRates={showPurchaseRates}
          sessionId={session.id}
          onClose={goList}
          onVoided={(m) => {
            setMsg(m);
            refresh();
            goList();
          }}
          onError={setError}
        />
      ) : (
        <VoucherList
          initialQ={listQ}
          onView={openView}
          onOpenForm={openForm}
          onMsg={setMsg}
          onError={setError}
        />
      )}
    </>
  );
}

export default function AccountsVouchersPage() {
  return (
    <Suspense
      fallback={
        <AccountsShell>
          <p>Loading…</p>
        </AccountsShell>
      }
    >
      <VouchersPageWithShell />
    </Suspense>
  );
}

function VouchersPageWithShell() {
  const search = useSearchParams();
  const focusMode = !!search.get("new");

  return (
    <AccountsShell focusMode={focusMode}>
      <VouchersInner />
    </AccountsShell>
  );
}
