"use client";

import { useTranslations } from "next-intl";

/** Checkbox used next to admin actions that can notify the customer. */
export function NotifyWhatsAppToggle({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
}) {
  const t = useTranslations();
  return (
    <label className="flex items-center gap-2 text-sm text-[var(--ink-muted)]">
      <input
        type="checkbox"
        className="h-4 w-4 accent-[var(--brand)]"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      {t("common.notifyWhatsApp")}
    </label>
  );
}
