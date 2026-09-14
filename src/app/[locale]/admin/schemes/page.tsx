"use client";

import { FormEvent, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { AdminAccessDenied } from "@/components/AdminAccessDenied";
import { AdminShell } from "@/components/AdminShell";
import { NumberField } from "@/components/NumberField";
import { OrderDiscountExplain } from "@/components/OrderDiscountExplain";
import { categoryLabel } from "@/lib/categories";
import { useDb, useSession } from "@/lib/hooks";
import { formatInr } from "@/lib/pricing";
import {
  adminSchemeLevelPreview,
  dealerOrderDiscountView,
  defaultSchemeTerms,
  estimateSchemePayout,
  formatSchemeDuration,
  getSchemeLevels,
  isOrderDiscountScheme,
  isPercentScheme,
  schemeProgressUnit,
  schemeScopeLabel,
  schemeTierRate,
} from "@/lib/schemes";
import { autoFillLocalized } from "@/lib/translate-client";
import { deleteScheme, checkCapability, upsertScheme } from "@/lib/store/db";
import type {
  ProductCategory,
  Scheme,
  SchemeLevel,
  SchemeProgressUnit,
  SchemeRewardType,
  SchemeScopeType,
} from "@/lib/types";

function defaultEnd(): string {
  return new Date(Date.now() + 90 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function AdminSchemesPage() {
  const t = useTranslations();
  const locale = useLocale() as "en" | "hi";
  const { session } = useSession();
  const { db, refresh } = useDb();
  const [editing, setEditing] = useState<Scheme | null>(null);
  const [busy, setBusy] = useState(false);

  const blankLevel = (n: number): SchemeLevel => {
    const targetAmount = n === 1 ? 1000 : n === 2 ? 5000 : n * 5000;
    return {
      id: `lvl_${crypto.randomUUID()}`,
      name: { en: `${targetAmount}+`, hi: `${targetAmount}+` },
      targetAmount,
      ratePerUnit: n === 1 ? 1 : n === 2 ? 1.5 : 1 + n * 0.25,
    };
  };

  const blank = (): Scheme => {
    const levels = [blankLevel(1), blankLevel(2), blankLevel(3)];
    return {
      id: `scheme_${crypto.randomUUID()}`,
      name: { en: "", hi: "" },
      description: { en: "", hi: "" },
      termsAndConditions: defaultSchemeTerms("per_kg_rate"),
      progressUnit: "kg",
      targetWeightKg: levels[levels.length - 1].targetAmount,
      rewardType: "per_kg_rate",
      creditAmount: 0,
      discountPerKg: 0,
      levels,
      scopeType: "category",
      scopeCategory: "tarpaulin",
      scopeProductIds: [],
      appliesToAllDealers: true,
      active: true,
      startDate: new Date(today()).toISOString(),
      endDate: new Date(defaultEnd()).toISOString(),
      createdAt: new Date().toISOString(),
    };
  };

  const onSave = async (e: FormEvent) => {
    e.preventDefault();
    if (!editing) return;
    setBusy(true);
    try {
      const baseFields = [
        editing.name || { en: "", hi: "" },
        editing.description || { en: "", hi: "" },
        editing.termsAndConditions || { en: "", hi: "" },
        ...getSchemeLevels(editing).map((l) => l.name || { en: "", hi: "" }),
      ];
      // Translation is optional — never block saving on Hindi fill.
      let translated = baseFields.map((f) => ({
        en: f.en || "",
        hi: f.hi || f.en || "",
      }));
      try {
        const filled = await autoFillLocalized(baseFields);
        if (Array.isArray(filled) && filled.length === baseFields.length) {
          translated = filled.map((f, idx) => ({
            en: f?.en || baseFields[idx]?.en || "",
            hi: f?.hi || f?.en || baseFields[idx]?.en || "",
          }));
        }
      } catch {
        /* keep fallback */
      }
      const take = (idx: number, fb: { en: string; hi: string }) => {
        const f = translated[idx];
        return {
          en: f?.en || fb.en || "",
          hi: f?.hi || f?.en || fb.hi || fb.en || "",
        };
      };
      let i = 0;
      const name = take(i++, editing.name || { en: "", hi: "" });
      const description = take(i++, editing.description || { en: "", hi: "" });
      const termsAndConditions = take(
        i++,
        editing.termsAndConditions || { en: "", hi: "" }
      );
      const levels = getSchemeLevels(editing).map((l) => {
        const tierName = take(i++, l.name || { en: "", hi: "" });
        return {
          ...l,
          name: {
            en: tierName.en || l.name.en,
            hi: tierName.hi || l.name.hi || tierName.en || l.name.en,
          },
          ratePerUnit: schemeTierRate(editing, l),
        };
      });
      const top = levels[levels.length - 1];
      const rewardType: SchemeRewardType =
        editing.rewardType === "percent"
          ? "percent"
          : editing.rewardType === "order_percent"
            ? "order_percent"
            : editing.rewardType === "order_rate"
              ? "order_rate"
              : editing.rewardType === "order_flat"
                ? "order_flat"
                : editing.rewardType === "order_per_kg"
                  ? "order_per_kg"
                  : "per_kg_rate";
      upsertScheme({
        ...editing,
        name,
        description,
        termsAndConditions,
        rewardType,
        levels,
        targetWeightKg: top?.targetAmount ?? editing.targetWeightKg,
        discountPerKg:
          rewardType === "percent" || rewardType === "order_percent"
            ? 0
            : top
              ? schemeTierRate(editing, top)
              : editing.discountPerKg,
        discountPercent:
          rewardType === "percent" || rewardType === "order_percent"
            ? top
              ? schemeTierRate(editing, top)
              : editing.discountPercent ?? 0
            : 0,
        creditAmount: 0,
      });
      setEditing(null);
      refresh();
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "Save failed");
    } finally {
      setBusy(false);
    }
  };

  if (!session || !checkCapability(session, db, "manage_schemes")) {
    return (
      <AdminShell>
        <AdminAccessDenied />
      </AdminShell>
    );
  }

  return (
    <AdminShell>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{t("admin.schemes")}</h1>
          <p className="mt-1 text-sm text-[var(--ink-muted)]">
            {t("admin.schemesPageHint")}
          </p>
        </div>
        <button
          type="button"
          className="tt-btn tt-btn-dark"
          onClick={() => setEditing(blank())}
        >
          {t("admin.schemesNew")}
        </button>
      </div>

      <div className="tt-panel mt-5 overflow-x-auto">
        <table className="tt-table min-w-[960px]">
          <thead>
            <tr>
              <th>{t("admin.schemesColScheme")}</th>
              <th>{t("admin.schemesColScope")}</th>
              <th>{t("admin.schemesColHow")}</th>
              <th>{t("admin.schemesColDates")}</th>
              <th>{t("admin.schemesColActive")}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {(db?.schemes ?? []).map((s) => (
              <tr key={s.id}>
                <td>
                  <div className="font-medium">{s.name[locale]}</div>
                  <div className="text-xs text-[var(--ink-muted)]">
                    {s.description[locale]}
                  </div>
                </td>
                <td className="text-sm">
                  {schemeScopeLabel(
                    s,
                    locale,
                    db?.products ?? [],
                    db?.categories
                  )}
                  {s.appliesToAllDealers ? (
                    <div className="text-xs text-[var(--brand)]">
                      {t("admin.schemesAllDealersBadge")}
                    </div>
                  ) : (
                    <div className="text-xs text-[var(--ink-muted)]">
                      {t("admin.schemesAssignedBadge")}
                    </div>
                  )}
                </td>
                <td className="text-sm">
                  <div className="text-xs font-semibold text-[var(--brand-deep)]">
                    {isOrderDiscountScheme(s)
                      ? t("admin.schemesKindBill")
                      : t("admin.schemesKindWallet")}
                  </div>
                  <ul className="mt-1 space-y-0.5 text-xs text-[var(--ink-muted)]">
                    {getSchemeLevels(s).map((level) => (
                      <li key={level.id}>
                        {adminSchemeLevelPreview(s, level, locale)}
                      </li>
                    ))}
                  </ul>
                </td>
                <td className="text-xs">{formatSchemeDuration(s, locale)}</td>
                <td>
                  <input
                    type="checkbox"
                    checked={s.active}
                    onChange={(e) => {
                      upsertScheme({ ...s, active: e.target.checked });
                      refresh();
                    }}
                  />
                </td>
                <td className="space-x-3 whitespace-nowrap">
                  <button
                    type="button"
                    className="text-sm font-semibold text-[var(--brand)]"
                    onClick={() =>
                      setEditing({
                        ...structuredClone(s),
                        levels: getSchemeLevels(s),
                      })
                    }
                  >
                    {t("admin.schemesEditBtn")}
                  </button>
                  <button
                    type="button"
                    className="text-sm font-semibold text-[var(--danger)]"
                    onClick={() => {
                      const ok = window.confirm(
                        t("admin.schemesDeleteConfirm", { name: s.name[locale] })
                      );
                      if (!ok) return;
                      try {
                        deleteScheme(s.id);
                        if (editing?.id === s.id) setEditing(null);
                        refresh();
                      } catch (err) {
                        window.alert(
                          err instanceof Error ? err.message : "Delete failed"
                        );
                      }
                    }}
                  >
                    {t("admin.schemesDeleteBtn")}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editing ? (
        <form onSubmit={onSave} className="tt-panel mt-6 space-y-4 p-5">
          <h2 className="text-lg font-semibold">{t("admin.schemesEdit")}</h2>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="tt-label">{t("admin.schemesNameEn")}</label>
              <input
                className="tt-input"
                value={editing.name.en}
                onChange={(e) =>
                  setEditing({
                    ...editing,
                    name: { ...editing.name, en: e.target.value },
                  })
                }
                required
              />
            </div>
            <div>
              <label className="tt-label">{t("admin.schemesNameHi")}</label>
              <input
                className="tt-input"
                value={editing.name.hi}
                onChange={(e) =>
                  setEditing({
                    ...editing,
                    name: { ...editing.name, hi: e.target.value },
                  })
                }
              />
            </div>
            <div className="sm:col-span-2">
              <label className="tt-label">{t("admin.schemesDescEn")}</label>
              <textarea
                className="tt-textarea"
                value={editing.description.en}
                onChange={(e) =>
                  setEditing({
                    ...editing,
                    description: { ...editing.description, en: e.target.value },
                  })
                }
              />
            </div>
            <div className="sm:col-span-2">
              <label className="tt-label">{t("admin.schemesDescHi")}</label>
              <textarea
                className="tt-textarea"
                value={editing.description.hi}
                onChange={(e) =>
                  setEditing({
                    ...editing,
                    description: { ...editing.description, hi: e.target.value },
                  })
                }
              />
            </div>
          </div>

          <div className="rounded-xl border border-[var(--line)] bg-[var(--surface)] p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs font-bold uppercase tracking-wide text-[var(--ink-muted)]">
                {editing.rewardType === "order_rate"
                  ? t("admin.schemesSectionBillRate")
                  : editing.rewardType === "order_per_kg"
                  ? t("admin.schemesSectionBillPerKg")
                  : editing.rewardType === "order_percent"
                  ? t("admin.schemesSectionBillPct")
                  : editing.rewardType === "order_flat"
                    ? t("admin.schemesSectionBillFlat")
                    : isPercentScheme(editing)
                      ? t("admin.schemesSectionWalletPct")
                      : t("admin.schemesSectionWalletRate")}
              </p>
              <div className="flex flex-wrap gap-2">
                <select
                  className="tt-select w-auto min-w-[11rem]"
                  value={editing.rewardType}
                  onChange={(e) => {
                    const rewardType = e.target.value as SchemeRewardType;
                    setEditing({
                      ...editing,
                      rewardType,
                      termsAndConditions: defaultSchemeTerms(rewardType),
                    });
                  }}
                >
                  <optgroup label={t("admin.schemesKindBill")}>
                    <option value="order_rate">
                      {t("admin.schemesTypeBillRate")}
                    </option>
                    <option value="order_percent">
                      {t("admin.schemesTypeBillPct")}
                    </option>
                    <option value="order_per_kg">
                      {t("admin.schemesTypeBillPerKg")}
                    </option>
                    <option value="order_flat">
                      {t("admin.schemesTypeBillFlat")}
                    </option>
                  </optgroup>
                  <optgroup label={t("admin.schemesKindWallet")}>
                    <option value="per_kg_rate">
                      {t("admin.schemesTypeWalletRate")}
                    </option>
                    <option value="percent">
                      {t("admin.schemesTypeWalletPct")}
                    </option>
                  </optgroup>
                </select>
                <select
                  className="tt-select w-auto min-w-[7rem]"
                  value={schemeProgressUnit(editing)}
                  onChange={(e) =>
                    setEditing({
                      ...editing,
                      progressUnit: e.target.value as SchemeProgressUnit,
                    })
                  }
                >
                  <option value="kg">
                    {isOrderDiscountScheme(editing)
                      ? t("admin.schemesQtyKg")
                      : t("admin.schemesLiftKg")}
                  </option>
                  <option value="bundles">
                    {isOrderDiscountScheme(editing)
                      ? t("admin.schemesQtyBundles")
                      : t("admin.schemesLiftBundles")}
                  </option>
                </select>
                <button
                  type="button"
                  className="tt-btn tt-btn-outline"
                  onClick={() => {
                    const levels = [
                      ...(editing.levels?.length
                        ? editing.levels
                        : getSchemeLevels(editing)),
                      blankLevel((editing.levels?.length || 0) + 1),
                    ];
                    setEditing({ ...editing, levels });
                  }}
                >
                  {isOrderDiscountScheme(editing)
                    ? t("admin.schemesAddQtyStep")
                    : t("admin.schemesAddLiftStep")}
                </button>
              </div>
            </div>
            <p className="mt-2 text-xs text-[var(--ink-muted)]">
              {editing.rewardType === "order_rate"
                ? t("admin.schemesHintBillRate")
                : editing.rewardType === "order_per_kg"
                ? t("admin.schemesHintBillPerKg")
                : editing.rewardType === "order_percent"
                ? t("admin.schemesHintBillPct")
                : editing.rewardType === "order_flat"
                  ? t("admin.schemesHintBillFlat")
                  : isPercentScheme(editing)
                    ? t("admin.schemesHintWalletPct")
                    : t("admin.schemesHintWalletRate")}
            </p>
            {isOrderDiscountScheme(editing) ? (
              <div className="mt-3 rounded-lg border border-[var(--line)] bg-white p-3">
                <p className="mb-1 text-xs font-bold uppercase tracking-wide text-[var(--ink-muted)]">
                  {t("admin.schemesDealerSees")}
                </p>
                <OrderDiscountExplain
                  view={dealerOrderDiscountView(editing, locale)}
                  compact
                />
              </div>
            ) : (
              <p className="mt-2 text-xs text-[var(--ink-muted)]">
                {t("admin.schemesWalletNote")}
              </p>
            )}
            <div className="mt-3 space-y-3">
              {(editing.levels?.length
                ? editing.levels
                : getSchemeLevels(editing)
              ).map((level, i) => {
                const unitShort =
                  schemeProgressUnit(editing) === "bundles"
                    ? locale === "hi"
                      ? "बंडल"
                      : "bdl"
                    : locale === "hi"
                      ? "किग्रा"
                      : "kg";
                const rateLabel =
                  editing.rewardType === "order_percent"
                    ? t("admin.schemesPctOffBill")
                    : editing.rewardType === "order_rate"
                      ? t("admin.schemesRupeeOffRate")
                    : editing.rewardType === "order_per_kg"
                      ? t("admin.schemesPerKgOff")
                    : editing.rewardType === "order_flat"
                      ? t("admin.schemesFlatOffBill")
                      : isPercentScheme(editing)
                        ? t("admin.schemesPctWallet")
                        : t("admin.schemesRateWallet", { unit: unitShort });
                return (
                <div
                  key={level.id}
                  className="grid gap-2 rounded-lg border border-[var(--line)] bg-white p-3 sm:grid-cols-[1fr_1fr_7rem_7rem_auto]"
                >
                  <p className="sm:col-span-5 text-sm font-semibold text-[var(--brand-deep)]">
                    {adminSchemeLevelPreview(editing, level, locale)}
                  </p>
                  <div>
                    <label className="tt-label">{t("admin.schemesStepNameEn")}</label>
                    <input
                      className="tt-input"
                      value={level.name.en}
                      onChange={(e) => {
                        const levels = [
                          ...(editing.levels?.length
                            ? editing.levels
                            : getSchemeLevels(editing)),
                        ];
                        levels[i] = {
                          ...levels[i],
                          name: { ...levels[i].name, en: e.target.value },
                        };
                        setEditing({ ...editing, levels });
                      }}
                    />
                  </div>
                  <div>
                    <label className="tt-label">{t("admin.schemesStepNameHi")}</label>
                    <input
                      className="tt-input"
                      value={level.name.hi}
                      onChange={(e) => {
                        const levels = [
                          ...(editing.levels?.length
                            ? editing.levels
                            : getSchemeLevels(editing)),
                        ];
                        levels[i] = {
                          ...levels[i],
                          name: { ...levels[i].name, hi: e.target.value },
                        };
                        setEditing({ ...editing, levels });
                      }}
                    />
                  </div>
                  <div>
                    <label className="tt-label">
                      {isOrderDiscountScheme(editing)
                        ? t("admin.schemesMinBillQty", { unit: unitShort })
                        : t("admin.schemesMinLift", { unit: unitShort })}
                    </label>
                    <NumberField
                      min={0}
                      className="tt-input"
                      emptyAs={null}
                      value={level.targetAmount}
                      onValueChange={(v) => {
                        const levels = [
                          ...(editing.levels?.length
                            ? editing.levels
                            : getSchemeLevels(editing)),
                        ];
                        levels[i] = {
                          ...levels[i],
                          targetAmount: typeof v === "number" ? v : 0,
                        };
                        setEditing({ ...editing, levels });
                      }}
                    />
                  </div>
                  <div>
                    <label className="tt-label">{rateLabel}</label>
                    <NumberField
                      min={0}
                      step="0.01"
                      className="tt-input"
                      emptyAs={null}
                      value={level.ratePerUnit ?? 0}
                      onValueChange={(v) => {
                        const levels = [
                          ...(editing.levels?.length
                            ? editing.levels
                            : getSchemeLevels(editing)),
                        ];
                        levels[i] = {
                          ...levels[i],
                          ratePerUnit: typeof v === "number" ? v : 0,
                        };
                        setEditing({ ...editing, levels });
                      }}
                    />
                  </div>
                  <div className="flex items-end">
                    <button
                      type="button"
                      className="tt-btn tt-btn-outline w-full text-[var(--danger)]"
                      disabled={
                        (editing.levels?.length ||
                          getSchemeLevels(editing).length) <= 1
                      }
                      onClick={() => {
                        const levels = (
                          editing.levels?.length
                            ? editing.levels
                            : getSchemeLevels(editing)
                        ).filter((_, idx) => idx !== i);
                        setEditing({ ...editing, levels });
                      }}
                    >
                      {t("admin.schemesRemoveStep")}
                    </button>
                  </div>
                </div>
                );
              })}
            </div>
            <p className="mt-3 text-xs font-semibold text-[var(--brand-deep)]">
              {editing.rewardType === "order_percent"
                ? t("admin.schemesTopBillPct", {
                    pct:
                      (editing.levels || getSchemeLevels(editing)).slice(-1)[0]
                        ?.ratePerUnit || 0,
                    n: (editing.levels || getSchemeLevels(editing)).length,
                  })
                : editing.rewardType === "order_rate"
                  ? t("admin.schemesTopBillRate", {
                      amount:
                        (editing.levels || getSchemeLevels(editing)).slice(-1)[0]
                          ?.ratePerUnit || 0,
                      after: Math.max(
                        0,
                        100 -
                          ((editing.levels || getSchemeLevels(editing)).slice(
                            -1
                          )[0]?.ratePerUnit || 0)
                      ),
                      n: (editing.levels || getSchemeLevels(editing)).length,
                    })
                : editing.rewardType === "order_per_kg"
                  ? t("admin.schemesTopBillPerKg", {
                      amount: formatInr(
                        (editing.levels || getSchemeLevels(editing)).slice(-1)[0]
                          ?.ratePerUnit || 0,
                        locale
                      ),
                      n: (editing.levels || getSchemeLevels(editing)).length,
                    })
                : editing.rewardType === "order_flat"
                  ? t("admin.schemesTopBillFlat", {
                      amount: formatInr(
                        (editing.levels || getSchemeLevels(editing)).slice(-1)[0]
                          ?.ratePerUnit || 0,
                        locale
                      ),
                      n: (editing.levels || getSchemeLevels(editing)).length,
                    })
                  : isPercentScheme(editing)
                    ? t("admin.schemesTopWalletPct", {
                        pct:
                          (editing.levels || getSchemeLevels(editing)).slice(
                            -1
                          )[0]?.ratePerUnit || 0,
                        n: (editing.levels || getSchemeLevels(editing)).length,
                      })
                    : t("admin.schemesTopWalletRate", {
                        amount: formatInr(
                          estimateSchemePayout(
                            editing,
                            (editing.levels || getSchemeLevels(editing)).slice(
                              -1
                            )[0]?.targetAmount || 0
                          ),
                          locale
                        ),
                        n: (editing.levels || getSchemeLevels(editing)).length,
                      })}
            </p>
          </div>

          <div className="rounded-xl border border-[var(--line)] bg-[var(--surface)] p-4">
            <p className="text-xs font-bold uppercase tracking-wide text-[var(--ink-muted)]">
              {t("admin.schemesScope")}
            </p>
            <p className="mt-1 text-xs text-[var(--ink-muted)]">
              {isOrderDiscountScheme(editing)
                ? t("admin.schemesScopeHintBill")
                : t("admin.schemesScopeHintWallet")}
            </p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div>
                <label className="tt-label">{t("admin.schemesScopeField")}</label>
                <select
                  className="tt-select"
                  value={editing.scopeType}
                  onChange={(e) =>
                    setEditing({
                      ...editing,
                      scopeType: e.target.value as SchemeScopeType,
                    })
                  }
                >
                  <option value="all">{t("admin.schemesScopeAll")}</option>
                  <option value="category">
                    {t("admin.schemesScopeCategory")}
                  </option>
                  <option value="product">
                    {t("admin.schemesScopeProducts")}
                  </option>
                </select>
              </div>
              {editing.scopeType === "category" ? (
                <div>
                  <label className="tt-label">{t("admin.schemesCategory")}</label>
                  <select
                    className="tt-select"
                    value={editing.scopeCategory ?? ""}
                    onChange={(e) =>
                      setEditing({
                        ...editing,
                        scopeCategory: e.target.value as ProductCategory,
                      })
                    }
                  >
                    {(db?.categories ?? [])
                      .filter((c) => c.active)
                      .map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name[locale]}
                        </option>
                      ))}
                  </select>
                </div>
              ) : null}
              {editing.scopeType === "product" ? (
                <div className="sm:col-span-2">
                  <label className="tt-label">{t("admin.schemesSelectProducts")}</label>
                  <div className="mt-2 max-h-48 space-y-2 overflow-y-auto rounded-lg border border-[var(--line)] bg-white p-3">
                    {(db?.products ?? []).map((p) => {
                      const checked = editing.scopeProductIds.includes(p.id);
                      return (
                        <label key={p.id} className="flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(e) => {
                              const ids = e.target.checked
                                ? [...editing.scopeProductIds, p.id]
                                : editing.scopeProductIds.filter((id) => id !== p.id);
                              setEditing({ ...editing, scopeProductIds: ids });
                            }}
                          />
                          <span>
                            {categoryLabel(db?.categories, p.category, locale)} ·{" "}
                            {p.itemName?.[locale] || p.name[locale]} — {p.code}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              ) : null}
              <label className="flex items-center gap-2 text-sm sm:col-span-2">
                <input
                  type="checkbox"
                  checked={editing.appliesToAllDealers}
                  onChange={(e) =>
                    setEditing({
                      ...editing,
                      appliesToAllDealers: e.target.checked,
                    })
                  }
                />
                {t("admin.schemesAllDealers")}
              </label>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="tt-label">{t("admin.schemesStart")}</label>
              <input
                type="date"
                className="tt-input"
                value={editing.startDate.slice(0, 10)}
                onChange={(e) =>
                  setEditing({
                    ...editing,
                    startDate: new Date(e.target.value).toISOString(),
                  })
                }
                required
              />
            </div>
            <div>
              <label className="tt-label">{t("admin.schemesEnd")}</label>
              <input
                type="date"
                className="tt-input"
                value={editing.endDate.slice(0, 10)}
                onChange={(e) =>
                  setEditing({
                    ...editing,
                    endDate: new Date(e.target.value + "T23:59:59").toISOString(),
                  })
                }
                required
              />
            </div>
            <div className="sm:col-span-2">
              <label className="tt-label">{t("admin.schemesTermsEn")}</label>
              <textarea
                className="tt-textarea min-h-[120px]"
                value={editing.termsAndConditions.en}
                onChange={(e) =>
                  setEditing({
                    ...editing,
                    termsAndConditions: {
                      ...editing.termsAndConditions,
                      en: e.target.value,
                    },
                  })
                }
                placeholder="1) ...&#10;2) ..."
              />
            </div>
            <div className="sm:col-span-2">
              <label className="tt-label">{t("admin.schemesTermsHi")}</label>
              <textarea
                className="tt-textarea min-h-[120px]"
                value={editing.termsAndConditions.hi}
                onChange={(e) =>
                  setEditing({
                    ...editing,
                    termsAndConditions: {
                      ...editing.termsAndConditions,
                      hi: e.target.value,
                    },
                  })
                }
              />
            </div>
          </div>

          <div className="flex gap-3">
            <button
              type="submit"
              className="tt-btn tt-btn-dark"
              disabled={busy}
            >
              {busy
                ? locale === "hi"
                  ? "अनुवाद व सेव…"
                  : "Translating & saving…"
                : t("common.save")}
            </button>
            <button
              type="button"
              className="tt-btn tt-btn-outline"
              disabled={busy}
              onClick={() => setEditing(null)}
            >
              {t("common.cancel")}
            </button>
          </div>
        </form>
      ) : null}
    </AdminShell>
  );
}
