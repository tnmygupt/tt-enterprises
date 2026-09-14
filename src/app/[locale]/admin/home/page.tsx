"use client";

import { useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/routing";
import { AdminAccessDenied } from "@/components/AdminAccessDenied";
import { AdminShell } from "@/components/AdminShell";
import { SearchSelect } from "@/components/SearchSelect";
import { useDb, useSession } from "@/lib/hooks";
import { loc } from "@/lib/localized";
import { moveId } from "@/lib/home-merch";
import { checkCapability, saveHomeMerchLists } from "@/lib/store/db";

type CatalogRow = { id: string; label: string; thumb: string };

function MerchList({
  title,
  hint,
  ids,
  products,
  onChange,
}: {
  title: string;
  hint: string;
  ids: string[];
  products: CatalogRow[];
  onChange: (next: string[]) => void;
}) {
  const t = useTranslations();
  const [pick, setPick] = useState("");
  const rows = ids
    .map((id) => products.find((p) => p.id === id))
    .filter((p): p is CatalogRow => !!p);
  const available = products.filter((p) => !ids.includes(p.id));

  return (
    <div className="rounded-2xl border border-[var(--line)] bg-white p-5">
      <h2 className="text-lg font-semibold text-[var(--brand-deep)]">{title}</h2>
      <p className="mt-1 text-sm text-[var(--ink-muted)]">{hint}</p>

      <div className="mt-4">
        <SearchSelect
          className="w-full"
          value={pick}
          onChange={(v) => {
            if (!v) {
              setPick("");
              return;
            }
            onChange([...ids.filter((id) => id !== v), v]);
            setPick("");
          }}
          placeholder={t("admin.homeAddProduct")}
          emptyLabel={t("common.search")}
          options={available.map((p) => ({
            value: p.id,
            label: p.label,
            searchText: p.label,
          }))}
        />
      </div>

      {rows.length ? (
        <ul className="mt-4 space-y-2">
          {rows.map((p, i) => (
            <li
              key={p.id}
              className="flex items-center gap-3 rounded-xl border border-[var(--line)] p-2"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={p.thumb}
                alt=""
                className="h-12 w-12 shrink-0 rounded-lg object-cover"
                style={{ background: "#eef0f3" }}
              />
              <p className="min-w-0 flex-1 truncate text-sm font-medium text-[var(--ink)]">
                {p.label}
              </p>
              <div className="flex shrink-0 gap-1">
                <button
                  type="button"
                  className="tt-btn tt-btn-outline px-2 py-1 text-xs"
                  disabled={i === 0}
                  onClick={() => onChange(moveId(ids, p.id, -1))}
                >
                  {t("common.moveUp")}
                </button>
                <button
                  type="button"
                  className="tt-btn tt-btn-outline px-2 py-1 text-xs"
                  disabled={i === rows.length - 1}
                  onClick={() => onChange(moveId(ids, p.id, 1))}
                >
                  {t("common.moveDown")}
                </button>
                <button
                  type="button"
                  className="tt-btn tt-btn-outline px-2 py-1 text-xs"
                  onClick={() => onChange(ids.filter((id) => id !== p.id))}
                >
                  {t("common.remove")}
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-4 text-sm text-[var(--ink-muted)]">{t("common.empty")}</p>
      )}
    </div>
  );
}

export default function AdminHomeMerchPage() {
  const t = useTranslations();
  const locale = useLocale() as "en" | "hi";
  const { session } = useSession();
  const { db, refresh } = useDb();
  const [msg, setMsg] = useState("");

  const catalog = useMemo(() => {
    return [...(db?.products ?? [])]
      .filter((p) => p.active)
      .sort((a, b) =>
        loc(a.name, locale, a.code).localeCompare(loc(b.name, locale, b.code))
      )
      .map((p) => ({
        id: p.id,
        label: `${p.code} · ${loc(p.name, locale, p.code)}`,
        thumb: p.logoUrl || p.media?.[0]?.url || "",
      }));
  }, [db, locale]);

  if (
    !session ||
    !checkCapability(session, db, "manage_products") ||
    session.role !== "super_admin"
  ) {
    return (
      <AdminShell>
        <AdminAccessDenied />
      </AdminShell>
    );
  }

  if (!db) {
    return (
      <AdminShell>
        <p>{t("common.loading")}</p>
      </AdminShell>
    );
  }

  const newIds = db.settings.homeNewProductIds ?? [];
  const promoIds = db.settings.homePromoProductIds ?? [];

  return (
    <AdminShell>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{t("admin.homePage")}</h1>
          <p className="mt-1 text-sm text-[var(--ink-muted)]">
            {t("admin.homePageHint")}
          </p>
        </div>
        <Link href="/" className="tt-btn tt-btn-outline">
          {t("nav.home")}
        </Link>
      </div>

      {msg ? (
        <p className="mt-4 rounded-xl bg-[#e8f2ea] p-3 text-sm text-[var(--ok)]">
          {msg}
        </p>
      ) : null}

      <div className="mt-6 grid gap-5 lg:grid-cols-2">
        <MerchList
          title={t("admin.homeNewProducts")}
          hint={t("admin.homeNewHint")}
          ids={newIds}
          products={catalog}
          onChange={(homeNewProductIds) => {
            saveHomeMerchLists({ homeNewProductIds });
            refresh();
            setMsg(t("common.saved"));
          }}
        />
        <MerchList
          title={t("admin.homePromoItems")}
          hint={t("admin.homePromoHint")}
          ids={promoIds}
          products={catalog}
          onChange={(homePromoProductIds) => {
            saveHomeMerchLists({ homePromoProductIds });
            refresh();
            setMsg(t("common.saved"));
          }}
        />
      </div>
    </AdminShell>
  );
}
