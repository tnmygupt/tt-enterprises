"use client";

import { FormEvent, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { AdminAccessDenied } from "@/components/AdminAccessDenied";
import { AdminShell } from "@/components/AdminShell";
import { NumberField } from "@/components/NumberField";
import { categoryLabel } from "@/lib/categories";
import { useDb, useSession } from "@/lib/hooks";
import { formatInr } from "@/lib/pricing";
import {
  estimateSchemePayout,
  formatSchemeDuration,
  getSchemeLevels,
  isOrderDiscountScheme,
  isPercentScheme,
  schemeProgressUnit,
  schemeRewardLabel,
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

  const blankLevel = (n: number): SchemeLevel => ({
    id: `lvl_${crypto.randomUUID()}`,
    name: { en: `Tier ${n}`, hi: `टियर ${n}` },
    targetAmount: n === 1 ? 1000 : n === 2 ? 5000 : n * 5000,
    ratePerUnit: n === 1 ? 1 : n === 2 ? 1.5 : 1 + n * 0.25,
  });

  const blank = (): Scheme => {
    const levels = [blankLevel(1), blankLevel(2), blankLevel(3)];
    return {
      id: `scheme_${crypto.randomUUID()}`,
      name: { en: "", hi: "" },
      description: { en: "", hi: "" },
      termsAndConditions: {
        en: "Highest unlocked tier rate applies to full lift. Single wallet credit after scheme end date.",
        hi: "ऊँचा अनलॉक टियर रेट पूरे लिफ्ट पर। स्कीम समाप्ति पर एक वॉलेट क्रेडिट।",
      },
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
            : editing.rewardType === "order_flat"
              ? "order_flat"
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

  if (!session || !checkCapability(session, db?.users, "manage_schemes")) {
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
            {locale === "hi"
              ? "लिफ्टिंग (वॉलेट) या प्रति-ऑर्डर बिल छूट — टियर से मात्रा"
              : "Lifting (wallet) or per-order bill discount — tiered by qty"}
          </p>
        </div>
        <button
          type="button"
          className="tt-btn tt-btn-dark"
          onClick={() => setEditing(blank())}
        >
          + New scheme
        </button>
      </div>

      <div className="tt-panel mt-5 overflow-x-auto">
        <table className="tt-table min-w-[960px]">
          <thead>
            <tr>
              <th>Scheme</th>
              <th>Scope</th>
              <th>Reward</th>
              <th>Duration</th>
              <th>Active</th>
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
                    <div className="text-xs text-[var(--brand)]">All dealers</div>
                  ) : (
                    <div className="text-xs text-[var(--ink-muted)]">Assigned only</div>
                  )}
                </td>
                <td className="text-sm">{schemeRewardLabel(s, locale)}</td>
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
                    Edit
                  </button>
                  <button
                    type="button"
                    className="text-sm font-semibold text-[var(--danger)]"
                    onClick={() => {
                      const ok = window.confirm(
                        locale === "hi"
                          ? `"${s.name[locale]}" स्कीम डिलीट करें? यह वापस नहीं आएगी।`
                          : `Delete scheme "${s.name[locale]}"? This cannot be undone.`
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
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editing ? (
        <form onSubmit={onSave} className="tt-panel mt-6 space-y-4 p-5">
          <h2 className="text-lg font-semibold">
            {locale === "hi" ? "स्कीम बनाएँ / संपादित करें" : "Create / edit scheme"}
          </h2>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="tt-label">Name (EN) *</label>
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
              <label className="tt-label">Name (HI)</label>
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
              <label className="tt-label">Short description (EN)</label>
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
              <label className="tt-label">Short description (HI)</label>
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
                {editing.rewardType === "order_percent"
                  ? "Tiers (% off this order — unlock by order qty)"
                  : editing.rewardType === "order_flat"
                    ? "Tiers (₹ off this order — unlock by order qty)"
                    : isPercentScheme(editing)
                      ? "Tiers (% of sales — unlock by lift)"
                      : "Tiers (₹ per unit on full lift)"}
              </p>
              <div className="flex flex-wrap gap-2">
                <select
                  className="tt-select w-auto min-w-[11rem]"
                  value={editing.rewardType}
                  onChange={(e) => {
                    const rewardType = e.target.value as SchemeRewardType;
                    const terms =
                      rewardType === "order_percent" ||
                      rewardType === "order_flat"
                        ? {
                            en: "Highest unlocked tier by this order’s qty. Discount applied on the order bill (not wallet).",
                            hi: "इस ऑर्डर की मात्रा से ऊँचा टियर। छूट बिल पर लगेगी (वॉलेट नहीं)।",
                          }
                        : {
                            en: "Highest unlocked tier rate applies to full lift. Single wallet credit after scheme end date.",
                            hi: "ऊँचा अनलॉक टियर रेट पूरे लिफ्ट पर। स्कीम समाप्ति पर एक वॉलेट क्रेडिट।",
                          };
                    setEditing({
                      ...editing,
                      rewardType,
                      termsAndConditions: terms,
                    });
                  }}
                >
                  <option value="per_kg_rate">Lifting: ₹ / unit → wallet</option>
                  <option value="percent">Lifting: % of sales → wallet</option>
                  <option value="order_percent">Per-order: % off bill</option>
                  <option value="order_flat">Per-order: ₹ off bill</option>
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
                      ? "Order qty: kg"
                      : "Lift unit: kg"}
                  </option>
                  <option value="bundles">
                    {isOrderDiscountScheme(editing)
                      ? "Order qty: bundles"
                      : "Lift unit: bundles"}
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
                  + Tier
                </button>
              </div>
            </div>
            <p className="mt-2 text-xs text-[var(--ink-muted)]">
              {editing.rewardType === "order_percent"
                ? "Example: 10 bundles → 2% off. 50 bundles → 5% off. Discount = % of this order’s scoped items only. Applied on each order bill."
                : editing.rewardType === "order_flat"
                  ? "Example: 10 bundles → ₹100 off. 50 bundles → ₹500 off. Capped at scoped items subtotal. Applied on each order bill."
                  : isPercentScheme(editing)
                    ? "Example: Tier 1 = 1000 kg → 1%. Tier 2 = 5000 kg → 2%. If dealer lifts 5000 kg, wallet credit = 2% of scheme product sales. One credit after end date."
                    : "Example: Tier 1 = 1000 kg @ ₹1/kg. Tier 2 = 5000 kg @ ₹1.5/kg. If dealer lifts 5000 kg, payout = 5000 × ₹1.5 (whole lift at higher rate). One wallet credit after end date."}
            </p>
            <div className="mt-3 space-y-3">
              {(editing.levels?.length
                ? editing.levels
                : getSchemeLevels(editing)
              ).map((level, i) => (
                <div
                  key={level.id}
                  className="grid gap-2 rounded-lg border border-[var(--line)] bg-white p-3 sm:grid-cols-[1fr_1fr_7rem_7rem_auto]"
                >
                  <div>
                    <label className="tt-label">Tier name (EN)</label>
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
                    <label className="tt-label">Tier name (HI)</label>
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
                      {isOrderDiscountScheme(editing) ? "Min order qty" : "Min lift"}{" "}
                      (
                      {schemeProgressUnit(editing) === "bundles" ? "bdl" : "kg"})
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
                    <label className="tt-label">
                      {editing.rewardType === "order_percent" ||
                      isPercentScheme(editing)
                        ? editing.rewardType === "order_percent"
                          ? "% off"
                          : "% discount"
                        : editing.rewardType === "order_flat"
                          ? "₹ off"
                          : `₹ / ${
                              schemeProgressUnit(editing) === "bundles"
                                ? "bdl"
                                : "kg"
                            }`}
                    </label>
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
                      Remove
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <p className="mt-3 text-xs font-semibold text-[var(--brand-deep)]">
              {editing.rewardType === "order_percent" ? (
                <>
                  Top tier:{" "}
                  {(editing.levels || getSchemeLevels(editing)).slice(-1)[0]
                    ?.ratePerUnit || 0}
                  % off this order ·{" "}
                  {(editing.levels || getSchemeLevels(editing)).length}{" "}
                  tier(s)
                </>
              ) : editing.rewardType === "order_flat" ? (
                <>
                  Top tier:{" "}
                  {formatInr(
                    (editing.levels || getSchemeLevels(editing)).slice(-1)[0]
                      ?.ratePerUnit || 0,
                    locale
                  )}{" "}
                  off this order ·{" "}
                  {(editing.levels || getSchemeLevels(editing)).length}{" "}
                  tier(s)
                </>
              ) : isPercentScheme(editing) ? (
                <>
                  Top tier:{" "}
                  {(editing.levels || getSchemeLevels(editing)).slice(-1)[0]
                    ?.ratePerUnit || 0}
                  % of scheme sales ·{" "}
                  {(editing.levels || getSchemeLevels(editing)).length}{" "}
                  tier(s)
                </>
              ) : (
                <>
                  Max at top tier:{" "}
                  {formatInr(
                    estimateSchemePayout(
                      editing,
                      (editing.levels || getSchemeLevels(editing)).slice(-1)[0]
                        ?.targetAmount || 0
                    ),
                    locale
                  )}{" "}
                  · {(editing.levels || getSchemeLevels(editing)).length}{" "}
                  tier(s)
                </>
              )}
            </p>
          </div>

          <div className="rounded-xl border border-[var(--line)] bg-[var(--surface)] p-4">
            <p className="text-xs font-bold uppercase tracking-wide text-[var(--ink-muted)]">
              Applies to (scope)
            </p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div>
                <label className="tt-label">Scope</label>
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
                  <option value="all">All products</option>
                  <option value="category">One category</option>
                  <option value="product">Selected items / products</option>
                </select>
              </div>
              {editing.scopeType === "category" ? (
                <div>
                  <label className="tt-label">Category</label>
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
                  <label className="tt-label">Select products</label>
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
                Apply to all dealers automatically
              </label>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="tt-label">Start date *</label>
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
              <label className="tt-label">End date *</label>
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
              <label className="tt-label">Terms & conditions (EN)</label>
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
              <label className="tt-label">Terms & conditions (HI)</label>
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
