"use client";

import { useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { AdminAccessDenied } from "@/components/AdminAccessDenied";
import { AdminShell } from "@/components/AdminShell";
import { NumberField } from "@/components/NumberField";
import { useDb, useSession } from "@/lib/hooks";
import {
  clearOrderHistoryAndSync,
  checkCapability,
  purgeOpsDataAndSync,
  resetDb,
  saveSettings,
} from "@/lib/store/db";
import { isFirebaseConfigured } from "@/lib/firebase/config";
import { uploadMediaFile } from "@/lib/upload-media";
import { UPI_MAX_AMOUNT_DEFAULT, listPayableAccounts } from "@/lib/upi";
import type { BankAccountDetails } from "@/lib/types";

export default function AdminSettingsPage() {
  const t = useTranslations();
  const locale = useLocale() as "en" | "hi";
  const { session } = useSession();
  const { db, refresh, cloudReady } = useDb();
  const [waConfigured, setWaConfigured] = useState<boolean | null>(null);
  const [supabaseConfigured, setSupabaseConfigured] = useState<boolean | null>(
    null
  );
  const [tallyStatus, setTallyStatus] = useState<string>("…");
  const [qrBusyId, setQrBusyId] = useState<string>("");
  const [msg, setMsg] = useState<string>("");
  const [purgeBusy, setPurgeBusy] = useState(false);
  // Memoize the derived accounts list here (before any conditional early
  // return) so React's rules-of-hooks are satisfied.
  const bankAccounts = useMemo(
    () => (db ? listPayableAccounts(db.settings) : []),
    [db]
  );

  useEffect(() => {
    void fetch("/api/whatsapp/send")
      .then((r) => r.json())
      .then((d: { configured?: boolean }) => setWaConfigured(!!d.configured))
      .catch(() => setWaConfigured(false));
    void fetch("/api/db")
      .then((r) => setSupabaseConfigured(r.status !== 503))
      .catch(() => setSupabaseConfigured(false));
    void fetch("/api/tally/sync")
      .then((r) => r.json())
      .then((d: { lastSyncedAt?: string | null; persist?: boolean }) => {
        setTallyStatus(
          d.lastSyncedAt
            ? `Last sync ${new Date(d.lastSyncedAt).toLocaleString()}`
            : d.persist
              ? "Ready — waiting for bridge"
              : "Not ready"
        );
      })
      .catch(() => setTallyStatus("API unreachable"));
  }, []);

  if (!session || !checkCapability(session, db?.users, "manage_users")) {
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
        <div>
          <label className="tt-label">GSTIN</label>
          <input
            className="tt-input"
            defaultValue={db.settings.gstin}
            onBlur={(e) => {
              saveSettings({ ...db.settings, gstin: e.target.value });
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
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="h-4 w-4 accent-[var(--brand)]"
            defaultChecked={db.settings.whatsappNotifyEnabled !== false}
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
                      <label className="tt-btn tt-btn-outline cursor-pointer text-sm">
                        {uploading
                          ? locale === "hi"
                            ? "अपलोड हो रहा है…"
                            : "Uploading…"
                          : a.staticQrDataUrl
                            ? locale === "hi"
                              ? "QR बदलें"
                              : "Replace QR"
                            : locale === "hi"
                              ? "QR अपलोड करें"
                              : "Upload QR image"}
                        <input
                          type="file"
                          accept="image/*"
                          className="hidden"
                          disabled={uploading}
                          onChange={async (e) => {
                            const file = e.target.files?.[0];
                            e.target.value = "";
                            if (!file) return;
                            await uploadStaticQr(id, file);
                          }}
                        />
                      </label>
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
        <p className="font-semibold text-[var(--ink)]">Auto reorder (draft POs)</p>
        <p className="text-[var(--ink-muted)]">
          Weekly cron hits <code>/api/cron/reorder</code> with{" "}
          <code>Authorization: Bearer CRON_SECRET</code>. Products need a
          preferred supplier. See <code>HOSTINGER.md</code>.
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
          Enable auto draft POs when cron runs
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="tt-label">Cron hint (display only)</label>
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
            <label className="tt-label">Min suggested qty</label>
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
                  : "Off — set SUPABASE_URL + SUPABASE_API_KEY"}
            </strong>
          </li>
          <li>
            Firebase shared DB:{" "}
            <strong className="text-[var(--ink)]">
              {isFirebaseConfigured()
                ? cloudReady
                  ? "Connected (sync on)"
                  : "Connecting…"
                : "Off — local browser only"}
            </strong>
          </li>
          <li>
            WhatsApp Cloud API:{" "}
            <strong className="text-[var(--ink)]">
              {waConfigured == null
                ? "Checking…"
                : waConfigured
                  ? "Configured (auto-send)"
                  : "Off — falls back to wa.me"}
            </strong>
          </li>
          <li>
            Tally sync API:{" "}
            <strong className="text-[var(--ink)]">{tallyStatus}</strong>
          </li>
          <li>
            Uploads:{" "}
            <strong className="text-[var(--ink)]">
              Firebase Storage when Firebase on, else server /uploads
            </strong>
          </li>
        </ul>
        <p className="mt-2 text-[var(--ink-muted)]">
          Set keys in <code>.env.local</code> (see <code>.env.example</code>).
          Deploy Firestore/Storage rules, enable Anonymous Auth, then restart{" "}
          <code>npm run dev</code>.
        </p>
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
        {session?.role === "super_admin" ? (
          <>
            <button
              type="button"
              className="tt-btn tt-btn-outline mt-2 ml-2 border-amber-700 text-amber-900"
              disabled={purgeBusy}
              onClick={() => {
                const ok = confirm(
                  "CLEAR ORDER HISTORY on cloud + this browser?\n\nRemoves: all orders (and order-linked wallet/stock movement rows).\n\nKeeps: all users, products, current stock qty.\n\nHard-refresh every other device after."
                );
                if (!ok) return;
                setPurgeBusy(true);
                setMsg("");
                void clearOrderHistoryAndSync()
                  .then((r) => {
                    if (!r.ok) {
                      setMsg(r.error || "Clear failed");
                      return;
                    }
                    setMsg(
                      `Cleared ${r.removedOrders ?? 0} orders. Users + stock kept. Hard-refresh other devices.`
                    );
                    refresh();
                  })
                  .finally(() => setPurgeBusy(false));
              }}
            >
              {purgeBusy ? "Clearing…" : "Clear order history only"}
            </button>
            <button
              type="button"
              className="tt-btn tt-btn-outline mt-2 ml-2 border-red-600 text-red-700"
              disabled={purgeBusy}
              onClick={() => {
                const ok = confirm(
                  "LAUNCH WIPE — cloud + this browser?\n\nRemoves: ALL products, schemes, orders, wallets, vouchers, ledger, parties, and every user EXCEPT 6386685663.\n\nKeeps: that owner login, company settings, categories, shipping rules, chart of accounts.\n\nEvery other device must hard-refresh after."
                );
                if (!ok) return;
                const again = confirm(
                  "This cannot be undone. Continue with launch wipe?"
                );
                if (!again) return;
                setPurgeBusy(true);
                setMsg("");
                void purgeOpsDataAndSync("6386685663")
                  .then((r) => {
                    if (!r.ok) {
                      setMsg(r.error || "Purge failed");
                      return;
                    }
                    setMsg(
                      `Launch wipe done. Removed ${r.removedUsers ?? 0} users, ${r.removedOrders ?? 0} orders. Products left: ${r.keptProducts ?? 0}. Hard-refresh other devices.`
                    );
                    refresh();
                  })
                  .finally(() => setPurgeBusy(false));
              }}
            >
              {purgeBusy
                ? "Clearing…"
                : "Launch wipe (keep only 6386685663)"}
            </button>
          </>
        ) : null}
      </div>
    </AdminShell>
  );
}
