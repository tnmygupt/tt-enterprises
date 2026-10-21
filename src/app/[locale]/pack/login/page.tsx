"use client";

import { FormEvent, useState } from "react";
import { useLocale } from "next-intl";
import { useRouter } from "@/i18n/routing";
import { isStaff, loginAsync, logout } from "@/lib/store/db";

export default function PackLoginPage() {
  const locale = useLocale();
  const hi = locale === "hi";
  const router = useRouter();
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const session = await loginAsync(phone, password);
      if (!isStaff(session.role)) {
        logout();
        setError(hi ? "यह साइट पैकिंग स्टाफ के लिए है।" : "This site is for packing staff.");
        return;
      }
      router.replace("/pack");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="mx-auto flex min-h-[100dvh] w-full max-w-md flex-col justify-center px-4 py-8">
      <h1 className="text-3xl font-semibold">{hi ? "पैकिंग" : "Packing"}</h1>
      <p className="mt-1 text-sm text-[var(--ink-muted)]">
        {hi ? "फोन और पासवर्ड से लॉगिन करें।" : "Sign in with phone and password."}
      </p>
      <form onSubmit={onSubmit} className="mt-6 space-y-3">
        <label className="block text-sm font-semibold">
          {hi ? "फोन" : "Phone"}
          <input
            className="tt-input mt-1 pack-tap min-h-[48px] w-full text-base"
            inputMode="tel"
            autoComplete="username"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            required
          />
        </label>
        <label className="block text-sm font-semibold">
          {hi ? "पासवर्ड" : "Password"}
          <input
            className="tt-input mt-1 pack-tap min-h-[48px] w-full text-base"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>
        {error ? <p className="text-sm text-[var(--brand)]">{error}</p> : null}
        <button type="submit" className="tt-btn tt-btn-dark pack-tap min-h-[48px] w-full" disabled={busy}>
          {busy ? "…" : hi ? "लॉगिन" : "Sign in"}
        </button>
      </form>
    </main>
  );
}
