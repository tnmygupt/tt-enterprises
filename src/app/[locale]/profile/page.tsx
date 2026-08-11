"use client";

import { FormEvent, useEffect, useState } from "react";
import { TransportInput } from "@/components/TransportInput";
import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/routing";
import { useDb, useSession } from "@/lib/hooks";
import { updateCustomerProfile } from "@/lib/store/db";

export default function ProfilePage() {
  const t = useTranslations();
  const locale = useLocale() as "en" | "hi";
  const { session, ready } = useSession();
  const { db, refresh } = useDb();
  const user = db?.users.find((u) => u.id === session?.id);

  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [company, setCompany] = useState("");
  const [address, setAddress] = useState("");
  const [pincode, setPincode] = useState("");
  const [gstOrAadhar, setGstOrAadhar] = useState("");
  const [transport, setTransport] = useState("");
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!user) return;
    // Seed the form once the session store resolves
    /* eslint-disable react-hooks/set-state-in-effect */
    setName(user.name || "");
    setPhone(user.phone || "");
    setCompany(user.company || "");
    setAddress(user.address || "");
    setPincode(user.pincode || "");
    setGstOrAadhar(user.gstOrAadhar || "");
    setTransport(user.transport || "");
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [user]);

  if (!ready) {
    return (
      <section className="tt-section">
        <div className="tt-wrap">
          <p>{t("common.loading")}</p>
        </div>
      </section>
    );
  }

  if (!session) {
    return (
      <section className="tt-section">
        <div className="tt-wrap tt-panel max-w-lg p-6">
          <p className="text-[var(--ink-muted)]">{t("common.loginRequired")}</p>
          <Link
            href="/"
            className="tt-btn tt-btn-dark mt-4 inline-flex w-full sm:w-auto"
          >
            {t("nav.login")}
          </Link>
        </div>
      </section>
    );
  }

  if (!user) {
    return (
      <section className="tt-section">
        <div className="tt-wrap">
          <p>{t("common.loading")}</p>
        </div>
      </section>
    );
  }

  const cancelEdit = () => {
    setEditing(false);
    setError("");
    setMsg("");
    setName(user.name || "");
    setPhone(user.phone || "");
    setCompany(user.company || "");
    setAddress(user.address || "");
    setPincode(user.pincode || "");
    setGstOrAadhar(user.gstOrAadhar || "");
    setTransport(user.transport || "");
  };

  const onSave = (e: FormEvent) => {
    e.preventDefault();
    setError("");
    setMsg("");
    const pin = pincode.replace(/\D/g, "").slice(0, 6);
    if (!name.trim() || !phone.trim() || !address.trim() || pin.length !== 6) {
      setError(
        locale === "hi"
          ? "नाम, मोबाइल, पता और 6 अंकों का पिनकोड ज़रूरी है"
          : "Name, phone, address and 6-digit pincode are required"
      );
      return;
    }
    setBusy(true);
    try {
      updateCustomerProfile(session.id, {
        name: name.trim(),
        phone: phone.trim(),
        company: company.trim(),
        address: address.trim(),
        pincode: pin,
        gstOrAadhar: gstOrAadhar.trim(),
        transport: transport.trim(),
      });
      refresh();
      setEditing(false);
      setMsg(
        locale === "hi" ? "प्रोफ़ाइल सेव हो गई।" : "Profile saved."
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setBusy(false);
    }
  };

  const rows: { label: string; value: string }[] = [
    { label: t("auth.name"), value: user.name || "—" },
    { label: t("auth.phone"), value: user.phone || "—" },
    { label: t("auth.company"), value: user.company || "—" },
    { label: t("auth.address"), value: user.address || "—" },
    { label: t("auth.pincode"), value: user.pincode || "—" },
    {
      label: t("checkout.gstAadhar"),
      value: user.gstOrAadhar || "—",
    },
    {
      label: t("checkout.transport"),
      value: user.transport || "—",
    },
  ];

  return (
    <section className="tt-section">
      <div className="tt-wrap max-w-2xl">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="tt-display text-3xl text-[var(--brand-deep)] sm:text-4xl">
              {t("nav.profile")}
            </h1>
            <p className="mt-1 text-sm text-[var(--ink-muted)]">
              {locale === "hi"
                ? "अपनी डीलर जानकारी देखें और अपडेट करें"
                : "View and update your dealer details"}
            </p>
          </div>
          {!editing ? (
            <button
              type="button"
              className="tt-btn tt-btn-dark"
              onClick={() => {
                setEditing(true);
                setMsg("");
                setError("");
              }}
            >
              {t("common.edit")}
            </button>
          ) : null}
        </div>

        {msg ? (
          <p className="mt-4 text-sm font-medium text-[var(--ok)]">{msg}</p>
        ) : null}
        {error ? (
          <p className="mt-4 text-sm font-medium text-[var(--danger)]">{error}</p>
        ) : null}

        {!editing ? (
          <div className="tt-panel mt-5 overflow-hidden p-0">
            <dl className="divide-y divide-[var(--line)]">
              {rows.map((r) => (
                <div
                  key={r.label}
                  className="grid gap-1 px-4 py-3 sm:grid-cols-[10rem_1fr] sm:gap-4"
                >
                  <dt className="text-xs font-bold uppercase tracking-wide text-[var(--ink-muted)]">
                    {r.label}
                  </dt>
                  <dd className="text-sm font-medium text-[var(--ink)] whitespace-pre-wrap">
                    {r.value}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        ) : (
          <form onSubmit={onSave} className="tt-panel mt-5 space-y-4 p-5">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label className="tt-label">{t("auth.name")} *</label>
                <input
                  className="tt-input"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                />
              </div>
              <div>
                <label className="tt-label">{t("auth.phone")} *</label>
                <input
                  className="tt-input"
                  inputMode="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  required
                />
                <p className="mt-1 text-xs text-[var(--ink-muted)]">
                  {locale === "hi"
                    ? "मोबाइल लॉगिन ID है — बदलने पर नया नंबर याद रखें"
                    : "Phone is your login ID — remember it if you change it"}
                </p>
              </div>
              <div>
                <label className="tt-label">{t("auth.company")}</label>
                <input
                  className="tt-input"
                  value={company}
                  onChange={(e) => setCompany(e.target.value)}
                />
              </div>
              <div className="sm:col-span-2">
                <label className="tt-label">{t("auth.address")} *</label>
                <textarea
                  className="tt-textarea"
                  rows={3}
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  required
                />
              </div>
              <div>
                <label className="tt-label">{t("auth.pincode")} *</label>
                <input
                  className="tt-input"
                  inputMode="numeric"
                  maxLength={6}
                  value={pincode}
                  onChange={(e) =>
                    setPincode(e.target.value.replace(/\D/g, "").slice(0, 6))
                  }
                  required
                />
              </div>
              <div>
                <label className="tt-label">{t("checkout.gstAadhar")}</label>
                <input
                  className="tt-input"
                  value={gstOrAadhar}
                  onChange={(e) => setGstOrAadhar(e.target.value)}
                />
              </div>
              <div className="sm:col-span-2">
                <label className="tt-label">{t("checkout.transport")}</label>
                <TransportInput
                  value={transport}
                  onChange={setTransport}
                  placeholder={
                    locale === "hi"
                      ? "पसंद का ट्रांसपोर्ट / पार्टी"
                      : "Preferred transport / party"
                  }
                />
              </div>
            </div>
            <div className="flex flex-wrap gap-2 pt-2">
              <button
                type="submit"
                className="tt-btn tt-btn-dark"
                disabled={busy}
              >
                {busy ? t("common.loading") : t("common.save")}
              </button>
              <button
                type="button"
                className="tt-btn tt-btn-outline"
                disabled={busy}
                onClick={cancelEdit}
              >
                {t("common.cancel")}
              </button>
            </div>
          </form>
        )}
      </div>
    </section>
  );
}
