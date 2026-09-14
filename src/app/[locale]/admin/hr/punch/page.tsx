"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { AdminAccessDenied } from "@/components/AdminAccessDenied";
import { AccountsPageHeader } from "@/components/AccountsPageHeader";
import { AdminShell } from "@/components/AdminShell";
import { FilePick } from "@/components/FilePick";
import { useDb, useSession } from "@/lib/hooks";
import { dateInIst, deriveDayAttendance } from "@/lib/hr";
import { clockStaffPunch, isStaff as roleIsStaff } from "@/lib/store/db";
import { uploadMediaFile } from "@/lib/upload-media";

export default function HrPunchPage() {
  const t = useTranslations();
  const { session, ready } = useSession();
  const { db, refresh } = useDb();
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [selfie, setSelfie] = useState<File | null>(null);

  if (ready && (!session || !roleIsStaff(session.role))) {
    return (
      <AdminShell>
        <AdminAccessDenied />
      </AdminShell>
    );
  }

  const today = dateInIst(new Date().toISOString());
  const terms = (db?.hrTerms ?? []).find((x) => x.userId === session?.id);
  const att = session
    ? deriveDayAttendance(db?.hrPunches ?? [], session.id, today)
    : null;
  const last = (db?.hrPunches ?? [])
    .filter((p) => p.userId === session?.id)
    .sort((a, b) => b.at.localeCompare(a.at))[0];

  const punch = async (kind: "in" | "out", gpsFallback = false) => {
    if (!session) return;
    setBusy(true);
    setMsg("");
    try {
      let photoUrl: string | undefined;
      if (selfie) {
        const up = await uploadMediaFile(selfie, "hr");
        photoUrl = up.url;
      }
      let lat: number | undefined;
      let lng: number | undefined;
      let accuracyM: number | undefined;
      if (!gpsFallback) {
        const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
          if (!navigator.geolocation) {
            reject(new Error("Location not available"));
            return;
          }
          navigator.geolocation.getCurrentPosition(resolve, reject, {
            enableHighAccuracy: true,
            timeout: 20000,
            maximumAge: 0,
          });
        });
        lat = pos.coords.latitude;
        lng = pos.coords.longitude;
        accuracyM = pos.coords.accuracy;
      }
      const row = clockStaffPunch({
        userId: session.id,
        kind,
        lat,
        lng,
        accuracyM,
        photoUrl,
        userAgent: navigator.userAgent.slice(0, 180),
        gpsFallback,
      });
      setSelfie(null);
      setMsg(
        gpsFallback || row.gpsFallback
          ? t("admin.hrGpsFallbackSaved")
          : row.insideFence
            ? t("admin.hrInside")
            : `${t("admin.hrOutside")}${row.weakGps ? ` · ${t("admin.hrWeakGps")}` : ""}`
      );
      refresh();
    } catch (err) {
      const raw = err instanceof Error ? err.message : "";
      if (raw.includes("Selfie required")) setMsg(t("admin.hrSelfieRequired"));
      else if (raw.includes("Already clocked in")) setMsg(t("admin.hrDuplicateIn"));
      else if (raw.includes("Already clocked out")) setMsg(t("admin.hrDuplicateOut"));
      else if (raw.includes("Clock in before")) setMsg(t("admin.hrOutWithoutIn"));
      else if (raw.includes("Payroll locked")) setMsg(t("admin.hrPayrollLocked"));
      else if (
        raw === "Location not available" ||
        /denied|timeout|unavailable/i.test(raw)
      ) {
        setMsg(t("admin.hrNoLocation"));
      } else setMsg(t("admin.hrPunchFail"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AdminShell>
      <AccountsPageHeader
        title={t("admin.hrPunch")}
        hint={t("admin.hrPunchHint")}
        backHref="/admin/hr"
        backLabel={t("admin.hrDesk")}
      />
      {att ? (
        <p className="mt-3 text-sm">
          {today}
          {att.inAt ? ` · ${t("admin.hrPunchInAt")} ${att.inAt.slice(11, 16)}` : ""}
          {att.outAt ? ` · ${t("admin.hrPunchOutAt")} ${att.outAt.slice(11, 16)}` : ""}
          {att.late ? ` · ${t("admin.hrLate")}` : ""}
        </p>
      ) : null}
      {last ? (
        <p className="mt-1 text-xs text-[var(--ink-muted)]">
          {t("admin.hrLastPunch")}:{" "}
          {last.kind === "out" ? t("admin.hrClockOut") : t("admin.hrClockIn")}{" "}
          {last.at.replace("T", " ").slice(0, 16)}{" "}
          {last.insideFence ? t("admin.hrInside") : t("admin.hrOutside")}
        </p>
      ) : null}
      <div className="mt-4 max-w-sm">
        <p className="mb-1 text-sm font-medium">
          {terms?.requireSelfie ? t("admin.hrSelfieRequired") : t("admin.hrSelfie")}
        </p>
        <FilePick
          kind="photo"
          value={selfie}
          onChange={(files) => setSelfie(files[0] || null)}
        />
      </div>
      <div className="mt-6 grid max-w-md gap-3 sm:grid-cols-2">
        <button
          type="button"
          className="tt-btn tt-btn-dark min-h-16 text-lg"
          disabled={busy}
          onClick={() => void punch("in")}
        >
          {busy ? t("admin.hrLocating") : t("admin.hrClockIn")}
        </button>
        <button
          type="button"
          className="tt-btn tt-btn-outline min-h-16 text-lg"
          disabled={busy}
          onClick={() => void punch("out")}
        >
          {t("admin.hrClockOut")}
        </button>
      </div>
      {msg ? <p className="mt-4 text-sm font-medium">{msg}</p> : null}
      {msg === t("admin.hrNoLocation") ? (
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            className="tt-btn tt-btn-outline"
            disabled={busy}
            onClick={() => void punch("in", true)}
          >
            {t("admin.hrGpsFallback")} · {t("admin.hrClockIn")}
          </button>
          <button
            type="button"
            className="tt-btn tt-btn-outline"
            disabled={busy}
            onClick={() => void punch("out", true)}
          >
            {t("admin.hrGpsFallback")} · {t("admin.hrClockOut")}
          </button>
        </div>
      ) : null}
    </AdminShell>
  );
}
