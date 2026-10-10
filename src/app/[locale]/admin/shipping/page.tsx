"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { AdminAccessDenied } from "@/components/AdminAccessDenied";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { AdminShell } from "@/components/AdminShell";
import { NumberField } from "@/components/NumberField";
import { useDb, useSession } from "@/lib/hooks";
import { formatInr } from "@/lib/pricing";
import {
  checkCapability,
  saveSettings,
  saveShippingRules,
} from "@/lib/store/db";
import type { ShippingRule } from "@/lib/types";

export default function AdminShippingPage() {
  const t = useTranslations();
  const { session } = useSession();
  const { db, refresh } = useDb();
  const [rules, setRules] = useState<ShippingRule[] | null>(null);
  const current = rules ?? db?.shippingRules ?? [];

  if (!session || !checkCapability(session, db, "manage_shipping")) {
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

  return (
    <AdminShell>
      <AdminPageHeader title={t("admin.shipping")} hint={t("admin.shippingHint")} />

      <div className="mt-6 max-w-xl space-y-3 rounded-2xl border border-[var(--line)] bg-white p-5">
        <h2 className="font-semibold">{t("admin.jhalShipping")}</h2>
        <p className="text-xs text-[var(--ink-muted)]">
          Jhal bill = rate × weighed kg; shipping = jhals × X below. Pkt/pc bill
          = qty × rate per pc; shipping uses the pack weight set on the product
          (weight slab), not this jhal rate.
        </p>
        <div>
          <label className="tt-label">{t("admin.ratePerJhal")}</label>
          <NumberField
            min={0}
            step={1}
            className="tt-input max-w-xs"
            emptyAs={null}
            value={db.settings.jhalShipping?.ratePerJhal ?? 50}
            onValueChange={(v) => {
              if (v === "") return;
              saveSettings({
                ...db.settings,
                jhalShipping: {
                  ratePerJhal: Math.max(0, v),
                },
              });
              refresh();
            }}
          />
        </div>
        <p className="text-sm text-[var(--ink-muted)]">
          Current: 1 jhal ={" "}
          {formatInr(db.settings.jhalShipping?.ratePerJhal ?? 50)}
        </p>
      </div>

      <div className="mt-6 max-w-xl space-y-3 rounded-2xl border border-[var(--line)] bg-white p-5">
        <h2 className="font-semibold">
        <h2 className="font-semibold">{t("admin.kgShipping")}</h2>
        </h2>
        <p className="text-xs text-[var(--ink-muted)]">
          Any weight up to min kg → flat X. If heavier → X + ceil((weight −
          min) / step) × (X × fraction). Example: min 100, X ₹60 → under 100kg =
          ₹60; 249kg → ₹150.
        </p>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={db.settings.weightShipping?.enabled ?? false}
            onChange={(e) => {
              saveSettings({
                ...db.settings,
                weightShipping: {
                  ...(db.settings.weightShipping ?? {
                    enabled: true,
                    minWeightKg: 100,
                    flatRateX: 1000,
                    stepKg: 50,
                    stepFractionOfX: 0.5,
                  }),
                  enabled: e.target.checked,
                },
              });
              refresh();
            }}
          />
          Enable weight slab shipping
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="tt-label">Min weight (kg) — base X up to this</label>
            <NumberField
              className="tt-input"
              emptyAs={null}
              value={db.settings.weightShipping?.minWeightKg ?? 100}
              onValueChange={(v) => {
                if (v === "") return;
                saveSettings({
                  ...db.settings,
                  weightShipping: {
                    ...(db.settings.weightShipping ?? {
                      enabled: true,
                      minWeightKg: 100,
                      flatRateX: 1000,
                      stepKg: 50,
                      stepFractionOfX: 0.5,
                    }),
                    minWeightKg: v || 100,
                  },
                });
                refresh();
              }}
            />
          </div>
          <div>
            <label className="tt-label">Flat rate X (₹)</label>
            <NumberField
              className="tt-input"
              emptyAs={null}
              value={db.settings.weightShipping?.flatRateX ?? 1000}
              onValueChange={(v) => {
                if (v === "") return;
                saveSettings({
                  ...db.settings,
                  weightShipping: {
                    ...(db.settings.weightShipping ?? {
                      enabled: true,
                      minWeightKg: 100,
                      flatRateX: 1000,
                      stepKg: 50,
                      stepFractionOfX: 0.5,
                    }),
                    flatRateX: v,
                  },
                });
                refresh();
              }}
            />
          </div>
          <div>
            <label className="tt-label">Step every (kg)</label>
            <NumberField
              className="tt-input"
              emptyAs={null}
              value={db.settings.weightShipping?.stepKg ?? 50}
              onValueChange={(v) => {
                if (v === "") return;
                saveSettings({
                  ...db.settings,
                  weightShipping: {
                    ...(db.settings.weightShipping ?? {
                      enabled: true,
                      minWeightKg: 100,
                      flatRateX: 1000,
                      stepKg: 50,
                      stepFractionOfX: 0.5,
                    }),
                    stepKg: v || 50,
                  },
                });
                refresh();
              }}
            />
          </div>
          <div>
            <label className="tt-label">Increase = fraction of X (0.5 = half)</label>
            <NumberField
              step={0.1}
              min={0}
              className="tt-input"
              emptyAs={null}
              value={db.settings.weightShipping?.stepFractionOfX ?? 0.5}
              onValueChange={(v) => {
                if (v === "") return;
                saveSettings({
                  ...db.settings,
                  weightShipping: {
                    ...(db.settings.weightShipping ?? {
                      enabled: true,
                      minWeightKg: 100,
                      flatRateX: 1000,
                      stepKg: 50,
                      stepFractionOfX: 0.5,
                    }),
                    stepFractionOfX: v,
                  },
                });
                refresh();
              }}
            />
          </div>
        </div>
      </div>

      <h2 className="mt-8 text-sm font-bold uppercase tracking-wide text-[var(--ink-muted)]">
        Band rules (used when weight ≤ min, or slab off)
      </h2>
      <div className="mt-3 space-y-4">
        {current.map((rule, i) => (
          <div
            key={rule.id}
            className="grid gap-3 rounded-2xl border border-[var(--line)] bg-white p-4 sm:grid-cols-3"
          >
            <input
              className="tt-input sm:col-span-3"
              value={rule.name}
              onChange={(e) => {
                const next = [...current];
                next[i] = { ...rule, name: e.target.value };
                setRules(next);
              }}
            />
            <div>
              <label className="tt-label">Min kg</label>
              <NumberField
                className="tt-input"
                emptyAs={null}
                value={rule.minWeightKg}
                onValueChange={(v) => {
                  const next = [...current];
                  next[i] = {
                    ...rule,
                    minWeightKg: typeof v === "number" ? v : 0,
                  };
                  setRules(next);
                }}
              />
            </div>
            <div>
              <label className="tt-label">Max kg (blank = open)</label>
              <NumberField
                className="tt-input"
                emptyAs={null}
                value={rule.maxWeightKg ?? ""}
                onValueChange={(v) => {
                  const next = [...current];
                  next[i] = {
                    ...rule,
                    maxWeightKg: v === "" ? undefined : v,
                  };
                  setRules(next);
                }}
              />
            </div>
            <div>
              <label className="tt-label">Shipping ₹</label>
              <NumberField
                className="tt-input"
                emptyAs={null}
                value={rule.shippingAmount}
                onValueChange={(v) => {
                  const next = [...current];
                  next[i] = {
                    ...rule,
                    shippingAmount: typeof v === "number" ? v : 0,
                  };
                  setRules(next);
                }}
              />
            </div>
            <div>
              <label className="tt-label">Free above kg</label>
              <NumberField
                className="tt-input"
                emptyAs={null}
                value={rule.freeAboveWeightKg ?? ""}
                onValueChange={(v) => {
                  const next = [...current];
                  next[i] = {
                    ...rule,
                    freeAboveWeightKg: v === "" ? undefined : v,
                  };
                  setRules(next);
                }}
              />
            </div>
            <div>
              <label className="tt-label">Free above value</label>
              <NumberField
                className="tt-input"
                emptyAs={null}
                value={rule.freeAboveValue ?? ""}
                onValueChange={(v) => {
                  const next = [...current];
                  next[i] = {
                    ...rule,
                    freeAboveValue: v === "" ? undefined : v,
                  };
                  setRules(next);
                }}
              />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={rule.active}
                onChange={(e) => {
                  const next = [...current];
                  next[i] = { ...rule, active: e.target.checked };
                  setRules(next);
                }}
              />
              Active
            </label>
          </div>
        ))}
      </div>

      <div className="mt-6 flex flex-wrap gap-3">
        <button
          type="button"
          className="tt-btn tt-btn-outline"
          onClick={() =>
            setRules([
              ...current,
              {
                id: `ship_${crypto.randomUUID()}`,
                name: "New rule",
                minWeightKg: 0,
                minOrderValue: 0,
                shippingAmount: 0,
                active: true,
              },
            ])
          }
        >
          + Rule
        </button>
        <button
          type="button"
          className="tt-btn tt-btn-dark"
          onClick={() => {
            saveShippingRules(current);
            setRules(null);
            refresh();
          }}
        >
          Save shipping rules
        </button>
      </div>

      <div className="mt-10 max-w-xl space-y-3 rounded-2xl border border-[var(--line)] bg-white p-5">
        <h2 className="font-semibold">Full truck thresholds</h2>
        <div>
          <label className="tt-label">Min weight (kg)</label>
          <NumberField
            className="tt-input"
            emptyAs={null}
            value={db.settings.fullTruckMinWeightKg}
            onValueChange={(v) => {
              if (v === "") return;
              saveSettings({
                ...db.settings,
                fullTruckMinWeightKg: v,
              });
              refresh();
            }}
          />
        </div>
        <div>
          <label className="tt-label">Min order value (₹)</label>
          <NumberField
            className="tt-input"
            emptyAs={null}
            value={db.settings.fullTruckMinValue}
            onValueChange={(v) => {
              if (v === "") return;
              saveSettings({
                ...db.settings,
                fullTruckMinValue: v,
              });
              refresh();
            }}
          />
        </div>
        <p className="text-xs text-[var(--ink-muted)]">
          Current: {db.settings.fullTruckMinWeightKg} kg or{" "}
          {formatInr(db.settings.fullTruckMinValue)}
        </p>
      </div>
    </AdminShell>
  );
}
