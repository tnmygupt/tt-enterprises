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
  const [busyKind, setBusyKind] = useState<"in" | "out" | null>(null);
  const [selfie, setSelfie] = useState<File | null>(null);
  const locating = busyKind !== null;

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
    if (!session || locating) return;
    if (terms?.requireSelfie && !selfie) {
      setMsg(t("admin.hrSelfieMissing"));
      return;
    }
    setBusyKind(kind);
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
            timeout: 8000,
            maximumAge: 15000,
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
      setBusyKind(null);
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
      <div className="tt-panel mt-4 max-w-md p-4">
        <p className="tt-hr-section">{t("admin.hrPunchStatus")}</p>
        <p className="text-sm">
          {today}
          {att?.inAt ? ` · ${t("admin.hrPunchInAt")} ${att.inAt.slice(11, 16)}` : ""}
          {att?.outAt ? ` · ${t("admin.hrPunchOutAt")} ${att.outAt.slice(11, 16)}` : ""}
          {att?.late ? ` · ${t("admin.hrLate")}` : ""}
        </p>
        {last ? (
          <p className="mt-1 text-xs text-[var(--ink-muted)]">
            {t("admin.hrLastPunch")}:{" "}
            {last.kind === "out" ? t("admin.hrClockOut") : t("admin.hrClockIn")}{" "}
            {last.at.replace("T", " ").slice(0, 16)}{" "}
            {last.insideFence ? t("admin.hrInside") : t("admin.hrOutside")}
          </p>
        ) : null}

        <p className="mb-1 mt-4 text-sm font-medium">
          {terms?.requireSelfie ? t("admin.hrSelfieRequired") : t("admin.hrSelfie")}
        </p>
        <FilePick
          kind="photo"
          value={selfie}
          onChange={(files) => setSelfie(files[0] || null)}
        />

        {locating ? (
          <p className="mt-4 text-sm font-medium" role="status">
            {t("admin.hrLocatingBanner")}
          </p>
        ) : null}

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <button
            type="button"
            className="tt-btn tt-btn-dark min-h-16 text-lg"
            disabled={locating}
            onClick={() => void punch("in")}
          >
            {busyKind === "in" ? t("admin.hrLocating") : t("admin.hrClockIn")}
          </button>
          <button
            type="button"
            className="tt-btn tt-btn-outline min-h-16 text-lg"
            disabled={locating}
            onClick={() => void punch("out")}
          >
            {busyKind === "out" ? t("admin.hrLocating") : t("admin.hrClockOut")}
          </button>
        </div>

        {msg ? <p className="mt-4 text-sm font-medium">{msg}</p> : null}

        <div className="mt-4 rounded-xl border border-[var(--line)] bg-[var(--surface-2)] p-3">
          <p className="text-xs text-[var(--ink-muted)]">{t("admin.hrGpsFallbackHint")}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              className="tt-btn tt-btn-outline"
              disabled={locating}
              onClick={() => void punch("in", true)}
            >
              {t("admin.hrGpsFallback")} · {t("admin.hrClockIn")}
            </button>
            <button
              type="button"
              className="tt-btn tt-btn-outline"
              disabled={locating}
              onClick={() => void punch("out", true)}
            >
              {t("admin.hrGpsFallback")} · {t("admin.hrClockOut")}
            </button>
          </div>
        </div>
      </div>
    </AdminShell>
  );
}
