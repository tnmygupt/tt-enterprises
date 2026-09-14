"use client";

import { useMemo, useState } from "react";
import type { AppSettings, Locale, WhatsAppTemplateKey } from "@/lib/types";
import {
  WA_TEMPLATE_KEYS,
  WA_TEMPLATE_TOKENS,
  defaultWaTemplate,
  renderWaTemplate,
  resolveWaTemplate,
} from "@/lib/wa-format";

const LABELS: Record<WhatsAppTemplateKey, { en: string; hi: string }> = {
  order: { en: "Order update (dealer)", hi: "ऑर्डर अपडेट (डीलर)" },
  packing: { en: "Packing slip (dealer)", hi: "पैकिंग स्लिप (डीलर)" },
  lr: { en: "LR / delivered (dealer)", hi: "LR / डिलीवर (डीलर)" },
  staffOrder: { en: "New estimate (staff)", hi: "नया अनुमान (स्टाफ)" },
};

export function WhatsAppTemplateEditor({
  settings,
  locale,
  onSave,
}: {
  settings: AppSettings;
  locale: Locale;
  onSave: (next: AppSettings["whatsappTemplates"]) => void;
}) {
  const [key, setKey] = useState<WhatsAppTemplateKey>("order");
  const [lang, setLang] = useState<Locale>(locale);
  const current = resolveWaTemplate(key, lang, settings);
  const [draft, setDraft] = useState(current);
  const [syncedTemplate, setSyncedTemplate] = useState(current);
  if (current !== syncedTemplate) {
    setSyncedTemplate(current);
    setDraft(current);
  }

  const preview = useMemo(
    () =>
      renderWaTemplate(
        key,
        lang,
        {
          company: settings.companyName || "T T Enterprises",
          name: "Ravi Traders",
          dealer: "Ravi Traders",
          phone: "9876543210",
          order: "TT-104",
          status: lang === "hi" ? "स्टेटस: बिल तैयार — अभी पेमेंट करें" : "Status: Bill ready — please pay now",
          items: "• FPL Heavy Duty 8×5 Blue × 5\n• FPL Heavy Duty 10×7 Green × 2",
          qty: lang === "hi" ? "मात्रा: 7 बंडल" : "Qty: 7 bundles",
          kg: "86.5 kg",
          bill: "₹12,480",
          amount: "₹12,480",
          discount: lang === "hi" ? "छूट: ₹240" : "Discount: ₹240",
          payment:
            lang === "hi" ? "पेमेंट बाकी: ₹12,480" : "Payment due: ₹12,480",
          pay:
            lang === "hi"
              ? "UPI ऐप खोलें:\nupi://pay?pa=shop@upi"
              : "Open UPI app:\nupi://pay?pa=shop@upi",
          paid: "",
          due: "₹12,480",
          shipping: "₹400",
          wallet: "",
          lr: "",
          transport: "VRL",
          note: "",
          pdf:
            lang === "hi"
              ? "पैकिंग स्लिप PDF इस चैट में अटैच है।"
              : "Packing slip PDF is attached in this chat.",
          link:
            lang === "hi"
              ? "ऑर्डर खोलें (स्टेटस / पेमेंट / स्लिप):\nhttps://tanmayphotos.space/o/TT-104?pay=1"
              : "Open your order (status / pay / slip):\nhttps://tanmayphotos.space/o/TT-104?pay=1",
        },
        {
          ...settings,
          whatsappTemplates: {
            ...settings.whatsappTemplates,
            [key]: {
              ...settings.whatsappTemplates?.[key],
              [lang]: draft,
            },
          },
        }
      ),
    [draft, key, lang, settings]
  );

  const persist = (value: string) => {
    const trimmed = value.trim();
    const def = defaultWaTemplate(key, lang);
    const next = { ...(settings.whatsappTemplates || {}) };
    const slot = { ...(next[key] || {}) };
    if (!trimmed || trimmed === def) {
      delete slot[lang];
    } else {
      slot[lang] = value.slice(0, 2000);
    }
    if (!slot.en && !slot.hi) delete next[key];
    else next[key] = slot;
    onSave(Object.keys(next).length ? next : undefined);
  };

  return (
    <div className="space-y-3 border-t border-[var(--line)] pt-3">
      <p className="text-xs font-semibold text-[var(--ink)]">
        {locale === "hi" ? "मैसेज फॉर्मेट" : "Message format"}
      </p>
      <p className="text-xs text-[var(--ink-muted)]">
        {locale === "hi"
          ? "टोकन बदलें — {order} {status} {qty} {bill} {payment} {pay} {link}"
          : "Edit tokens — {order} {status} {qty} {bill} {payment} {pay} {link}"}
      </p>
      <div className="flex flex-wrap gap-2">
        {WA_TEMPLATE_KEYS.map((k) => (
          <button
            key={k}
            type="button"
            className={`tt-btn ${key === k ? "tt-btn-dark" : "tt-btn-outline"} text-xs`}
            onClick={() => setKey(k)}
          >
            {LABELS[k][locale]}
          </button>
        ))}
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          className={`tt-btn ${lang === "en" ? "tt-btn-dark" : "tt-btn-outline"} text-xs`}
          onClick={() => setLang("en")}
        >
          EN
        </button>
        <button
          type="button"
          className={`tt-btn ${lang === "hi" ? "tt-btn-dark" : "tt-btn-outline"} text-xs`}
          onClick={() => setLang("hi")}
        >
          HI
        </button>
        <button
          type="button"
          className="tt-btn tt-btn-outline text-xs"
          onClick={() => {
            const def = defaultWaTemplate(key, lang);
            setDraft(def);
            persist(def);
          }}
        >
          {locale === "hi" ? "डिफ़ॉल्ट" : "Reset default"}
        </button>
      </div>
      <p className="text-[11px] leading-relaxed text-[var(--ink-muted)]">
        {WA_TEMPLATE_TOKENS.map((t) => `{${t}}`).join(" ")}
      </p>
      <textarea
        className="tt-input min-h-[10rem] font-mono text-xs"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => persist(draft)}
      />
      <div className="rounded-xl bg-[var(--surface)] p-3">
        <p className="mb-1 text-[11px] font-bold uppercase text-[var(--ink-muted)]">
          {locale === "hi" ? "प्रीव्यू" : "Preview"}
        </p>
        <pre className="whitespace-pre-wrap text-xs leading-relaxed text-[var(--ink)]">
          {preview}
        </pre>
      </div>
    </div>
  );
}
