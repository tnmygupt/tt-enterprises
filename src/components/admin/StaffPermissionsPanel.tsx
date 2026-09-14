"use client";

import { useTranslations } from "next-intl";
import {
  ALL_CAPABILITIES,
  OWNER_ONLY_CAPABILITIES,
  capabilityLabel,
  rolePresetCapabilities,
} from "@/lib/capabilities";
import type { Capability, RolePresets, UserRole } from "@/lib/types";

export function StaffPermissionsPanel({
  role,
  checked,
  onChange,
  locale,
  disabled,
  title,
  presets,
}: {
  role: UserRole;
  checked: Capability[];
  onChange: (next: Capability[]) => void;
  locale: "en" | "hi";
  disabled?: boolean;
  title?: string;
  presets?: RolePresets | null;
}) {
  const t = useTranslations("admin");
  const set = new Set(checked);
  const isOwnerRole = role === "super_admin";
  const ownerOnly = new Set<Capability>(OWNER_ONLY_CAPABILITIES);

  return (
    <div className="rounded-lg border border-[var(--line)] bg-[var(--surface)] p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold text-[var(--ink)]">
          {title || t("peoplePermissions")}
        </p>
        {!isOwnerRole && !disabled ? (
          <button
            type="button"
            className="text-xs font-semibold text-[var(--brand)] underline underline-offset-2"
            onClick={() => onChange(rolePresetCapabilities(role, presets))}
          >
            {t("peopleResetDefaults")}
          </button>
        ) : null}
      </div>
      {isOwnerRole ? (
        <p className="text-xs text-[var(--ink-muted)]">
          {t("peopleOwnerCapsNote")}
        </p>
      ) : (
        <div className="grid gap-1.5 sm:grid-cols-2">
          {ALL_CAPABILITIES.map((cap) => {
            const locked = ownerOnly.has(cap);
            return (
              <label
                key={cap}
                className="flex items-start gap-2 text-sm text-[var(--ink)]"
              >
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={set.has(cap)}
                  disabled={disabled || locked}
                  onChange={(e) => {
                    const next = new Set(set);
                    if (e.target.checked) next.add(cap);
                    else next.delete(cap);
                    onChange(
                      ALL_CAPABILITIES.filter(
                        (c) => next.has(c) && !ownerOnly.has(c)
                      )
                    );
                  }}
                />
                <span>
                  {capabilityLabel(cap, locale)}
                  {locked ? (
                    <span className="ml-1 text-[10px] text-[var(--ink-muted)]">
                      ({t("peopleOwnerOnly")})
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
