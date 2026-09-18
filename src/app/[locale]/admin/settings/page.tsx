"use client";

import { useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/routing";
import { AdminAccessDenied } from "@/components/AdminAccessDenied";
import { AdminShell } from "@/components/AdminShell";
import { FilePick } from "@/components/FilePick";
import { NumberField } from "@/components/NumberField";
import { useDb, useSession } from "@/lib/hooks";
import {
  checkCapability,
  resetDb,
  saveSettings,
} from "@/lib/store/db";
import { uploadMediaFile } from "@/lib/upload-media";
import { formatSeasonMonths, parseSeasonMonthsFromText } from "@/lib/accounting";
import { UPI_MAX_AMOUNT_DEFAULT, listPayableAccounts } from "@/lib/upi";
import { WhatsAppTemplateEditor } from "@/components/WhatsAppTemplateEditor";
import type { BankAccountDetails } from "@/lib/types";

export default function AdminSettingsPage() {
  const t = useTranslations();
  const locale = useLocale() as "en" | "hi";
  const { session } = useSession();
  const { db, refresh, cloudReady } = useDb();
  const [waConfigured, setWaConfigured] = useState<boolean | null>(null);
  const [waMode, setWaMode] = useState<
    "tally_instance" | "cloud_api" | "wa.me_fallback" | null
  >(null);
  const [supabaseConfigured, setSupabaseConfigured] = useState<boolean | null>(
    null
  );
  const [qrBusyId, setQrBusyId] = useState<string>("");
  const [msg, setMsg] = useState<string>("");
  // Memoize the derived accounts list here (before any conditional early
  // return) so React's rules-of-hooks are satisfied.
  const bankAccounts = useMemo(
    () => (db ? listPayableAccounts(db.settings) : []),
    [db]
  );

  useEffect(() => {
    void fetch("/api/whatsapp/send")
      .then((r) => r.json())
      .then(
        (d: {
          configured?: boolean;
          mode?: "tally_instance" | "cloud_api" | "wa.me_fallback";
        }) => {
          setWaConfigured(!!d.configured);
          setWaMode(
            d.mode ?? (d.configured ? "cloud_api" : "wa.me_fallback")
          );
        }
      )
      .catch(() => {
        setWaConfigured(false);
        setWaMode("wa.me_fallback");
      });
    void fetch("/api/db")
      .then((r) => setSupabaseConfigured(r.status !== 503))
      .catch(() => setSupabaseConfigured(false));
  }, []);


  if (!session || !checkCapability(session, db, "manage_users")) {
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

  const bank = db.settings.bankAccount;

  const persistAccounts = (next: BankAccountDetails[]) => {
    saveSettings({ ...db.settings, bankAccounts: next });
    refresh();
  };
  const updateAccount = (id: string, patch: Partial<BankAccountDetails>) => {
    persistAccounts(
      bankAccounts.map((a) => (a.id === id ? { ...a, ...patch } : a))
    );
  };
  const addAccount = () => {
    const newAccount: BankAccountDetails = {
      id: `bank_${crypto.randomUUID()}`,
      label: locale === "hi" ? "नया खाता" : "New account",
      accountName: "",
      accountNumber: "",
      ifsc: "",
      bankName: "",
      branch: "",
      upiId: "",
      upiPayeeName: "",
      active: true,
      isDefault: bankAccounts.length === 0,
    };
    persistAccounts([...bankAccounts, newAccount]);
  };
  const removeAccount = (id: string) => {
    if (
      !window.confirm(
        locale === "hi"
          ? "यह खाता हटाना है?"
          : "Delete this payment account?"
      )
    ) {
      return;
    }
    const next = bankAccounts.filter((a) => a.id !== id);
    // If we removed the default, promote the first remaining account.
    if (next.length && !next.some((a) => a.isDefault)) {
      next[0] = { ...next[0], isDefault: true };
    }
    persistAccounts(next);
  };
  const setDefault = (id: string) => {
    persistAccounts(
      bankAccounts.map((a) => ({ ...a, isDefault: a.id === id }))
    );
  };
  const uploadStaticQr = async (id: string, file: File) => {
    setQrBusyId(id);
    setMsg("");
    try {
      const up = await uploadMediaFile(file, "misc");
      if (up.type !== "image") {
        throw new Error("Only images allowed");
      }
      updateAccount(id, { staticQrDataUrl: up.url });
      setMsg(locale === "hi" ? "QR अपलोड हुआ" : "QR uploaded");
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setQrBusyId("");
    }
  };

  return (
    <AdminShell>
      <h1 className="tt-display text-4xl text-[var(--brand-deep)]">
        {t("admin.settings")}
      </h1>

      <div className="mt-6 max-w-xl space-y-3 rounded-2xl border border-[var(--line)] bg-white p-5">
        <p className="text-xs font-bold uppercase tracking-wide text-[var(--ink-muted)]">
          Company
        </p>
        <div>
          <label className="tt-label">Company name</label>
          <input
            className="tt-input"
            defaultValue={db.settings.companyName}
            onBlur={(e) => {
              saveSettings({ ...db.settings, companyName: e.target.value });
              refresh();
            }}
          />
        </div>
        <div>
          <label className="tt-label">Phone</label>
          <input
            className="tt-input"
            defaultValue={db.settings.phone}
            onBlur={(e) => {
              saveSettings({ ...db.settings, phone: e.target.value });
              refresh();
            }}
          />
        </div>
        <div>
          <label className="tt-label">Phone 2 (optional)</label>
          <input
            className="tt-input"
            defaultValue={db.settings.phone2 ?? ""}
            onBlur={(e) => {
              saveSettings({ ...db.settings, phone2: e.target.value });
              refresh();
            }}
          />
        </div>
        <div>
          <label className="tt-label">Address 1</label>
          <textarea
            className="tt-textarea"
            defaultValue={db.settings.address}
            onBlur={(e) => {
              saveSettings({ ...db.settings, address: e.target.value });
              refresh();
            }}
          />
        </div>
        <div>
          <label className="tt-label">Address 2</label>
          <textarea
            className="tt-textarea"
            defaultValue={db.settings.address2 ?? ""}
            onBlur={(e) => {
              saveSettings({ ...db.settings, address2: e.target.value });
              refresh();
            }}
          />
        </div>
      </div>

      <div className="mt-6 max-w-xl space-y-3 rounded-2xl border border-[var(--line)] bg-white p-5">
        <p className="text-xs font-bold uppercase tracking-wide text-[var(--ink-muted)]">
          {t("whatsapp.settingsTitle")}
        </p>
        <p className="text-sm text-[var(--ink-muted)]">
          {t("whatsapp.settingsHint")}
        </p>
        <p className="text-sm">
          <Link href="/admin/whatsapp" className="font-semibold underline">
            {t("admin.whatsappDesk")}
          </Link>
        </p>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="h-4 w-4 accent-[var(--brand)]"
            checked={db.settings.whatsappNotifyEnabled !== false}
            onChange={(e) => {
              saveSettings({
                ...db.settings,
                whatsappNotifyEnabled: e.target.checked,
              });
              refresh();
            }}
          />
          {t("whatsapp.enabled")}
        </label>
        <p className="text-xs font-semibold text-[var(--ink)]">
          {t("whatsapp.eventsTitle")}
        </p>
        <ul className="list-disc space-y-0.5 pl-5 text-sm text-[var(--ink-muted)]">
          <li>{t("whatsapp.eventSignup")}</li>
          <li>{t("whatsapp.eventApproved")}</li>
          <li>{t("whatsapp.eventRejected")}</li>
          <li>{t("whatsapp.eventNewOrder")}</li>
          <li>{t("whatsapp.eventProof")}</li>
          <li>{t("whatsapp.eventVerified")}</li>
          <li>{t("whatsapp.eventStatus")}</li>
          <li>{t("whatsapp.eventPacking")}</li>
          <li>{t("whatsapp.eventOverdue")}</li>
          <li>{t("whatsapp.eventCredit")}</li>
          <li>{t("whatsapp.eventSchemeEnd")}</li>
          <li>{t("whatsapp.eventLowStock")}</li>
          <li>{t("whatsapp.eventDaily")}</li>
        </ul>
        <div>
          <label className="tt-label">{t("whatsapp.countryCode")}</label>
          <input
            className="tt-input max-w-[120px]"
            defaultValue={db.settings.whatsappCountryCode || "91"}
            onBlur={(e) => {
              saveSettings({
                ...db.settings,
                whatsappCountryCode: e.target.value.replace(/\D/g, "") || "91",
              });
              refresh();
            }}
          />
        </div>
        <WhatsAppTemplateEditor
          settings={db.settings}
          locale={locale}
          onSave={(whatsappTemplates) => {
            saveSettings({ ...db.settings, whatsappTemplates });
            refresh();
          }}
        />
      </div>

      <div className="mt-6 max-w-xl space-y-3 rounded-2xl border border-[var(--line)] bg-white p-5">
        <p className="text-xs font-bold uppercase tracking-wide text-[var(--ink-muted)]">
          {t("helpVideos.settingsTitle")}
        </p>
        <p className="text-sm text-[var(--ink-muted)]">
          {t("helpVideos.settingsHint")}
        </p>
        <div>
          <label className="tt-label">{t("helpVideos.dealerUrl")}</label>
          <input
            className="tt-input"
            placeholder="https://www.youtube.com/watch?v=…"
            defaultValue={db.settings.dealerHelpVideoUrl ?? ""}
            onBlur={(e) => {
              saveSettings({
                ...db.settings,
                dealerHelpVideoUrl: e.target.value.trim() || undefined,
              });
              refresh();
            }}
          />
        </div>
        <div>
          <label className="tt-label">{t("helpVideos.adminUrl")}</label>
          <input
            className="tt-input"
            placeholder="https://www.youtube.com/watch?v=…"
            defaultValue={db.settings.adminHelpVideoUrl ?? ""}
            onBlur={(e) => {
              saveSettings({
                ...db.settings,
                adminHelpVideoUrl: e.target.value.trim() || undefined,
              });
              refresh();
            }}
          />
        </div>
      </div>

      <div className="mt-6 max-w-3xl space-y-4 rounded-2xl border border-[var(--line)] bg-white p-5">
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-[var(--ink-muted)]">
            {locale === "hi"
              ? "पेमेंट सेटअप (नोट + UPI सीमा)"
              : "Payment setup (note + UPI cap)"}
          </p>
          <p className="mt-1 text-sm text-[var(--ink-muted)]">
            {locale === "hi"
              ? "पेमेंट पेज पर सबसे ऊपर दिखेगा। UPI सीमा से ज़्यादा बिल पर अपलोड किया गया QR दिखेगा।"
              : "Shown at the top of the payment page. Bills above the UPI cap fall back to the account's uploaded static QR."}
          </p>
        </div>
        <div>
          <label className="tt-label">
            {locale === "hi" ? "पेमेंट नोट" : "Payment note (shown to dealer)"}
          </label>
          <textarea
            className="tt-textarea"
            defaultValue={db.settings.paymentNote}
            onBlur={(e) => {
              saveSettings({ ...db.settings, paymentNote: e.target.value });
              refresh();
            }}
          />
        </div>
        <div>
          <label className="tt-label">
            {locale === "hi"
              ? `UPI QR सीमा (₹) — इससे ऊपर स्टैटिक QR दिखेगा`
              : `UPI amount cap (₹) — bills above this show the static QR`}
          </label>
          <NumberField
            className="tt-input max-w-[220px]"
            min={0}
            emptyAs={null}
            value={db.settings.upiMaxAmount ?? UPI_MAX_AMOUNT_DEFAULT}
            onValueChange={(v) => {
              if (v === "") return;
              saveSettings({
                ...db.settings,
                upiMaxAmount: v || UPI_MAX_AMOUNT_DEFAULT,
              });
              refresh();
            }}
          />
          <p className="mt-1 text-xs text-[var(--ink-muted)]">
            {locale === "hi"
              ? "डिफ़ॉल्ट ₹1,00,000 — भारत में अधिकांश बैंकों की एक-ट्रांज़ैक्शन UPI सीमा।"
              : "Default ₹1,00,000 — the effective per-transaction UPI limit at most Indian banks."}
          </p>
        </div>
      </div>

      <div className="mt-6 max-w-3xl space-y-4 rounded-2xl border border-[var(--line)] bg-white p-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-[var(--ink-muted)]">
              {locale === "hi"
                ? "पेमेंट खाते (कई जोड़ सकते हैं)"
                : "Payment accounts (multiple)"}
            </p>
            <p className="mt-1 text-sm text-[var(--ink-muted)]">
              {locale === "hi"
                ? "हर खाते का अपना UPI ID और अपलोड किया गया बड़े बिल का QR रखें।"
                : "Each account can have its own UPI ID and its own uploaded QR for high-value bills."}
            </p>
          </div>
          <button
            type="button"
            className="tt-btn tt-btn-dark"
            onClick={addAccount}
          >
            {locale === "hi" ? "+ नया खाता" : "+ Add account"}
          </button>
        </div>
        {msg ? (
          <p className="text-sm font-semibold text-[var(--ok)]">{msg}</p>
        ) : null}

        {!bankAccounts.length ? (
          <p className="rounded-lg border border-dashed border-[var(--line)] p-4 text-sm text-[var(--ink-muted)]">
            {locale === "hi"
              ? "अभी कोई खाता नहीं। ऊपर से नया जोड़ें।"
              : "No accounts yet — add one above."}
          </p>
        ) : null}

        <div className="space-y-4">
          {bankAccounts.map((a) => {
            const id = a.id || "";
            const uploading = qrBusyId === id;
            return (
              <div
                key={id}
                className="rounded-xl border border-[var(--line)] bg-[var(--surface)] p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-bold text-[var(--ink)]">
                      {a.label || a.bankName || "Account"}
                      {a.isDefault ? (
                        <span className="ml-2 rounded bg-[var(--brand-soft)] px-1.5 py-0.5 text-[10px] font-bold uppercase text-[var(--brand-deep,var(--brand))]">
                          {locale === "hi" ? "डिफ़ॉल्ट" : "Default"}
                        </span>
                      ) : null}
                      {a.active === false ? (
                        <span className="ml-2 rounded bg-[var(--surface-2)] px-1.5 py-0.5 text-[10px] font-bold uppercase text-[var(--ink-muted)]">
                          {locale === "hi" ? "बंद" : "Inactive"}
                        </span>
                      ) : null}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2 text-xs">
                    {!a.isDefault ? (
                      <button
                        type="button"
                        className="font-semibold text-[var(--brand)] underline underline-offset-2"
                        onClick={() => setDefault(id)}
                      >
                        {locale === "hi"
                          ? "डिफ़ॉल्ट बनाएँ"
                          : "Make default"}
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="font-semibold text-[var(--ink-muted)] underline underline-offset-2"
                      onClick={() =>
                        updateAccount(id, { active: a.active === false })
                      }
                    >
                      {a.active === false
                        ? locale === "hi"
                          ? "चालू करें"
                          : "Activate"
                        : locale === "hi"
                          ? "बंद करें"
                          : "Deactivate"}
                    </button>
                    <button
                      type="button"
                      className="font-semibold text-[var(--danger)] underline underline-offset-2"
                      onClick={() => removeAccount(id)}
                    >
                      {locale === "hi" ? "हटाएँ" : "Delete"}
                    </button>
                  </div>
                </div>

                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className="tt-label">
                      {locale === "hi" ? "उपनाम" : "Nickname / label"}
                    </label>
                    <input
                      className="tt-input"
                      defaultValue={a.label}
                      onBlur={(e) =>
                        updateAccount(id, { label: e.target.value.trim() })
                      }
                    />
                  </div>
                  <div>
                    <label className="tt-label">
                      {locale === "hi" ? "बैंक" : "Bank name"}
                    </label>
                    <input
                      className="tt-input"
                      defaultValue={a.bankName}
                      onBlur={(e) =>
                        updateAccount(id, { bankName: e.target.value.trim() })
                      }
                    />
                  </div>
                  <div>
                    <label className="tt-label">
                      {locale === "hi" ? "खाताधारक" : "Account holder"}
                    </label>
                    <input
                      className="tt-input"
                      defaultValue={a.accountName}
                      onBlur={(e) =>
                        updateAccount(id, {
                          accountName: e.target.value.trim(),
                        })
                      }
                    />
                  </div>
                  <div>
                    <label className="tt-label">
                      {locale === "hi" ? "अकाउंट नं." : "Account number"}
                    </label>
                    <input
                      className="tt-input font-mono"
                      defaultValue={a.accountNumber}
                      onBlur={(e) =>
                        updateAccount(id, {
                          accountNumber: e.target.value.trim(),
                        })
                      }
                    />
                  </div>
                  <div>
                    <label className="tt-label">IFSC</label>
                    <input
                      className="tt-input font-mono uppercase"
                      defaultValue={a.ifsc}
                      onBlur={(e) =>
                        updateAccount(id, {
                          ifsc: e.target.value.trim().toUpperCase(),
                        })
                      }
                    />
                  </div>
                  <div>
                    <label className="tt-label">
                      {locale === "hi" ? "ब्रांच (वैकल्पिक)" : "Branch (optional)"}
                    </label>
                    <input
                      className="tt-input"
                      defaultValue={a.branch}
                      onBlur={(e) =>
                        updateAccount(id, { branch: e.target.value.trim() })
                      }
                    />
                  </div>
                  <div>
                    <label className="tt-label">UPI ID (VPA)</label>
                    <input
                      className="tt-input"
                      placeholder="yourname@okaxis"
                      defaultValue={a.upiId}
                      onBlur={(e) =>
                        updateAccount(id, { upiId: e.target.value.trim() })
                      }
                    />
                  </div>
                  <div>
                    <label className="tt-label">
                      {locale === "hi" ? "UPI पर नाम" : "UPI payee name"}
                    </label>
                    <input
                      className="tt-input"
                      placeholder={db.settings.upiPayeeName || db.settings.companyName}
                      defaultValue={a.upiPayeeName}
                      onBlur={(e) =>
                        updateAccount(id, {
                          upiPayeeName: e.target.value.trim(),
                        })
                      }
                    />
                  </div>
                </div>

                <div className="mt-4 rounded-xl border border-dashed border-[var(--line)] bg-white p-3">
                  <p className="text-xs font-bold uppercase tracking-wide text-[var(--ink-muted)]">
                    {locale === "hi"
                      ? "बड़े बिल के लिए स्टैटिक QR"
                      : "Static QR for high-value bills"}
                  </p>
                  <p className="mt-1 text-xs text-[var(--ink-muted)]">
                    {locale === "hi"
                      ? `₹${(db.settings.upiMaxAmount ?? UPI_MAX_AMOUNT_DEFAULT).toLocaleString("hi-IN")} से ज़्यादा बिल पर यही QR दिखेगा (रकम मैन्युअल भरनी होगी)।`
                      : `Shown when the bill is above ₹${(db.settings.upiMaxAmount ?? UPI_MAX_AMOUNT_DEFAULT).toLocaleString("en-IN")} — dealer enters the amount manually.`}
                  </p>
                  <div className="mt-3 flex flex-wrap items-start gap-3">
                    {a.staticQrDataUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={a.staticQrDataUrl}
                        alt="Uploaded QR"
                        className="h-32 w-32 rounded border border-[var(--line)] bg-white object-contain p-1"
                      />
                    ) : (
                      <div className="flex h-32 w-32 items-center justify-center rounded border border-dashed border-[var(--line)] bg-[var(--surface-2)] text-xs text-[var(--ink-muted)]">
                        {locale === "hi" ? "कोई QR नहीं" : "No QR yet"}
                      </div>
                    )}
                    <div className="flex flex-col gap-2">
                      <FilePick
                        kind="qr"
                        compact
                        busy={uploading}
                        onPick={async (files) => {
                          const file = files[0];
                          if (!file) return;
                          await uploadStaticQr(id, file);
                        }}
                      />
                      {a.staticQrDataUrl ? (
                        <button
                          type="button"
                          className="text-xs font-semibold text-[var(--danger)] underline underline-offset-2 text-left"
                          onClick={() =>
                            updateAccount(id, { staticQrDataUrl: "" })
                          }
                        >
                          {locale === "hi" ? "QR हटाएँ" : "Remove QR"}
                        </button>
                      ) : null}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Legacy single-account block — hidden if migrated data is now
            being edited through the multi-account list above. Keeping the
            fallback lets old installs still edit the singleton until they
            explicitly add the first bankAccounts entry. */}
        {!db.settings.bankAccounts?.length ? (
          <details className="mt-2">
            <summary className="cursor-pointer text-xs font-semibold text-[var(--ink-muted)]">
              {locale === "hi"
                ? "पुराने खाता फ़ील्ड (केवल पुराने डेटा के लिए)"
                : "Legacy single-account fields (advanced)"}
            </summary>
            <div className="mt-2 grid gap-3 sm:grid-cols-2">
              <div>
                <label className="tt-label">Legacy UPI ID</label>
                <input
                  className="tt-input"
                  defaultValue={db.settings.upiId}
                  onBlur={(e) => {
                    saveSettings({
                      ...db.settings,
                      upiId: e.target.value.trim(),
                    });
                    refresh();
                  }}
                />
              </div>
              <div>
                <label className="tt-label">Legacy UPI payee name</label>
                <input
                  className="tt-input"
                  defaultValue={db.settings.upiPayeeName}
                  onBlur={(e) => {
                    saveSettings({
                      ...db.settings,
                      upiPayeeName: e.target.value.trim(),
                    });
                    refresh();
                  }}
                />
              </div>
              <div>
                <label className="tt-label">Legacy account name</label>
                <input
                  className="tt-input"
                  defaultValue={bank.accountName}
                  onBlur={(e) => {
                    saveSettings({
                      ...db.settings,
                      bankAccount: {
                        ...bank,
                        accountName: e.target.value.trim(),
                      },
                    });
                    refresh();
                  }}
                />
              </div>
              <div>
                <label className="tt-label">Legacy A/C no</label>
                <input
                  className="tt-input font-mono"
                  defaultValue={bank.accountNumber}
                  onBlur={(e) => {
                    saveSettings({
                      ...db.settings,
                      bankAccount: {
                        ...bank,
                        accountNumber: e.target.value.trim(),
                      },
                    });
                    refresh();
                  }}
                />
              </div>
              <div>
                <label className="tt-label">Legacy IFSC</label>
                <input
                  className="tt-input font-mono uppercase"
                  defaultValue={bank.ifsc}
                  onBlur={(e) => {
                    saveSettings({
                      ...db.settings,
                      bankAccount: {
                        ...bank,
                        ifsc: e.target.value.trim().toUpperCase(),
                      },
                    });
                    refresh();
                  }}
                />
              </div>
              <div>
                <label className="tt-label">Legacy bank name</label>
                <input
                  className="tt-input"
                  defaultValue={bank.bankName}
                  onBlur={(e) => {
                    saveSettings({
                      ...db.settings,
                      bankAccount: {
                        ...bank,
                        bankName: e.target.value.trim(),
                      },
                    });
                    refresh();
                  }}
                />
              </div>
            </div>
          </details>
        ) : null}
      </div>

      <div className="mt-8 space-y-3 rounded-2xl bg-[var(--surface-2)] p-5 text-sm">
        <p className="font-semibold text-[var(--ink)]">
          {t("admin.autoReorderTitle")}
        </p>
        <p className="text-[var(--ink-muted)]">{t("admin.autoReorderHint")}</p>
        <p className="text-[var(--ink-muted)]">
          {t("admin.autoReorderCover")}
        </p>
        <p className="text-[var(--ink-muted)]">
          Weekly cron hits <code>/api/cron/reorder</code> with{" "}
          <code>Authorization: Bearer CRON_SECRET</code>. Products need a
          preferred supplier. Auto POs are marked ordered and WhatsApp the
          owner only — not the mill. Overdue, credit-limit, scheme-ending and
          stale-estimate WhatsApp: <code>/api/cron/whatsapp-digest</code>. See{" "}
          <code>HOSTINGER.md</code>.
        </p>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            defaultChecked={!!db.settings.autoReorderEnabled}
            onChange={(e) => {
              saveSettings({
                ...db.settings,
                autoReorderEnabled: e.target.checked,
              });
              refresh();
            }}
          />
          {t("admin.autoReorderEnableCron")}
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={db.settings.autoReorderUseVelocity !== false}
            onChange={(e) => {
              saveSettings({
                ...db.settings,
                autoReorderUseVelocity: e.target.checked,
              });
              refresh();
            }}
          />
          {t("admin.autoReorderUseVelocity")}
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="tt-label">{t("admin.autoReorderCronHint")}</label>
            <input
              className="tt-input"
              defaultValue={db.settings.autoReorderCron || "0 6 * * 1"}
              placeholder="0 6 * * 1"
              onBlur={(e) => {
                saveSettings({
                  ...db.settings,
                  autoReorderCron: e.target.value.trim() || "0 6 * * 1",
                });
                refresh();
              }}
            />
            <p className="mt-1 text-xs text-[var(--ink-muted)]">
              Example: Mon 06:00 IST — configure the same schedule in Hostinger
              cron.
            </p>
          </div>
          <div>
            <label className="tt-label">{t("admin.autoReorderMinQty")}</label>
            <NumberField
              className="tt-input"
              min={1}
              integer
              emptyAs={null}
              value={db.settings.autoReorderMinQty ?? 1}
              onValueChange={(v) => {
                if (v === "") return;
                saveSettings({
                  ...db.settings,
                  autoReorderMinQty: Math.max(1, v),
                });
                refresh();
              }}
            />
          </div>
          <div>
            <label className="tt-label">{t("admin.autoReorderLookback")}</label>
            <NumberField
              className="tt-input"
              min={7}
              max={365}
              integer
              emptyAs={null}
              value={db.settings.autoReorderLookbackDays ?? 30}
              onValueChange={(v) => {
                if (v === "") return;
                saveSettings({
                  ...db.settings,
                  autoReorderLookbackDays: Math.max(7, Math.min(365, v)),
                });
                refresh();
              }}
            />
          </div>
          <div>
            <label className="tt-label">{t("admin.autoReorderLeadTime")}</label>
            <NumberField
              className="tt-input"
              min={0}
              integer
              emptyAs={null}
              value={db.settings.autoReorderLeadTimeDays ?? 10}
              onValueChange={(v) => {
                if (v === "") return;
                saveSettings({
                  ...db.settings,
                  autoReorderLeadTimeDays: Math.max(0, v),
                });
                refresh();
              }}
            />
          </div>
          <div>
            <label className="tt-label">{t("admin.autoReorderSafety")}</label>
            <NumberField
              className="tt-input"
              min={0}
              integer
              emptyAs={null}
              value={db.settings.autoReorderSafetyDays ?? 7}
              onValueChange={(v) => {
                if (v === "") return;
                saveSettings({
                  ...db.settings,
                  autoReorderSafetyDays: Math.max(0, v),
                });
                refresh();
              }}
            />
          </div>
          <div>
            <label className="tt-label">
              {t("admin.autoReorderSeasonMonths")}
            </label>
            <input
              className="tt-input"
              defaultValue={formatSeasonMonths(
                db.settings.autoReorderSeasonMonths
              )}
              placeholder="5-9"
              onBlur={(e) => {
                saveSettings({
                  ...db.settings,
                  autoReorderSeasonMonths: parseSeasonMonthsFromText(
                    e.target.value
                  ),
                });
                refresh();
              }}
            />
          </div>
          <div>
            <label className="tt-label">
              {t("admin.autoReorderSeasonMultiplier")}
            </label>
            <NumberField
              className="tt-input"
              min={1}
              step={0.1}
              emptyAs={null}
              value={db.settings.autoReorderSeasonMultiplier ?? 1.4}
              onValueChange={(v) => {
                if (v === "") return;
                saveSettings({
                  ...db.settings,
                  autoReorderSeasonMultiplier: Math.max(1, v),
                });
                refresh();
              }}
            />
          </div>
        </div>
      </div>

      <div className="mt-8 space-y-3 rounded-2xl bg-[var(--surface-2)] p-5 text-sm">
        <p className="font-semibold text-[var(--ink)]">Live integrations</p>
        <ul className="space-y-2 text-[var(--ink-muted)]">
          <li>
            Supabase shared DB:{" "}
            <strong className="text-[var(--ink)]">
              {supabaseConfigured == null
                ? "Checking…"
                : supabaseConfigured
                  ? cloudReady
                    ? "Connected (sync on)"
                    : "Connecting…"
                  : "Off — set SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY"}
            </strong>
          </li>
          <li>
            WhatsApp:{" "}
            <strong className="text-[var(--ink)]">
              {waConfigured == null
                ? "Checking…"
                : waMode === "tally_instance"
                  ? "Tally WhatsApp instance — silent send"
                  : waConfigured
                    ? "Meta Cloud API — silent send"
                    : "Off — falls back to wa.me"}
            </strong>
          </li>
          <li>
            Uploads:{" "}
            <strong className="text-[var(--ink)]">
              Server /api/upload (Supabase Storage when configured)
            </strong>
          </li>
        </ul>
        <p className="mt-2 text-[var(--ink-muted)]">{t("shop.cloudHint")}</p>
        <button
          type="button"
          className="tt-btn tt-btn-outline mt-2"
          onClick={() => {
            if (confirm("Reset all local demo data? (Cloud DB is not wiped)")) {
              resetDb();
              refresh();
            }
          }}
        >
          Reset local demo data
        </button>
      </div>
    </AdminShell>
  );
}
