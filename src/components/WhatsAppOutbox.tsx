"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  listWaOutbox,
  removeWaOutbox,
  type WaOutboxItem,
} from "@/lib/wa-outbox";
import { buildWhatsAppUrl, whatsappCountryCode } from "@/lib/whatsapp";
import { useDb } from "@/lib/hooks";

export function WhatsAppOutbox() {
  const t = useTranslations("whatsappOutbox");
  const locale = useLocale() as "en" | "hi";
  const { db } = useDb();
  const [items, setItems] = useState<WaOutboxItem[]>([]);
  const [open, setOpen] = useState(false);

  const refresh = () => setItems(listWaOutbox());

  useEffect(() => {
    // Subscribe to the outbox store, seeding with whatever is already queued
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refresh();
    const onUp = () => refresh();
    window.addEventListener("tt-wa-outbox-updated", onUp);
    window.addEventListener("storage", onUp);
    return () => {
      window.removeEventListener("tt-wa-outbox-updated", onUp);
      window.removeEventListener("storage", onUp);
    };
  }, []);

  if (!items.length) return null;

  const country = whatsappCountryCode(db?.settings);

  return (
    <div className="border-b border-[var(--line)] bg-[#fff8e8] px-3 py-2">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-2 text-left text-sm font-semibold text-[var(--ink)]"
        onClick={() => setOpen((v) => !v)}
      >
        <span>
          {t("title")} · {items.length}
        </span>
        <span className="text-xs text-[var(--ink-muted)]">
          {open ? (locale === "hi" ? "छिपाएँ" : "Hide") : t("open")}
        </span>
      </button>
      {open ? (
        <ul className="mt-2 max-h-56 space-y-2 overflow-y-auto">
          {items.map((item) => (
            <li
              key={item.id}
              className="rounded-lg border border-[var(--line)] bg-white p-2 text-xs"
            >
              <p className="font-semibold text-[var(--ink)]">
                {item.label || item.phone}
              </p>
              <p className="mt-1 line-clamp-2 text-[var(--ink-muted)]">
                {item.text}
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  className="font-semibold text-[var(--brand)] underline underline-offset-2"
                  onClick={() => {
                    const url = buildWhatsAppUrl(
                      item.phone,
                      item.text,
                      country
                    );
                    if (url) window.open(url, "_blank", "noopener,noreferrer");
                  }}
                >
                  {t("send")}
                </button>
                <button
                  type="button"
                  className="font-semibold text-[var(--ink-muted)] underline underline-offset-2"
                  onClick={() => {
                    void navigator.clipboard?.writeText(item.text);
                  }}
                >
                  {t("copy")}
                </button>
                <button
                  type="button"
                  className="font-semibold text-[var(--ok)] underline underline-offset-2"
                  onClick={() => {
                    removeWaOutbox(item.id);
                    refresh();
                  }}
                >
                  {t("done")}
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
