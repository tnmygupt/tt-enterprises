"use client";

import { FormEvent, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { StaffPermissionsPanel } from "@/components/admin/StaffPermissionsPanel";
import {
  ALL_CAPABILITIES,
  JOB_BASE_ROLES,
  OWNER_ONLY_CAPABILITIES,
  capabilityLabel,
  capabilityOverridesFromChecked,
  effectiveCapabilities,
  rolePresetCapabilities,
  staffJobLabel,
  staffRoleLabel,
} from "@/lib/capabilities";
import {
  deleteStaffJob,
  saveRolePresets,
  upsertStaffJob,
} from "@/lib/store/db";
import type { AppDatabase } from "@/lib/store/db";
import type {
  Capability,
  RolePresets,
  StaffJob,
  StaffJobBaseRole,
} from "@/lib/types";

function presetsFromDb(db: AppDatabase | null | undefined): RolePresets {
  const out: RolePresets = {};
  for (const role of JOB_BASE_ROLES) {
    out[role] = rolePresetCapabilities(role, db?.rolePresets);
  }
  return out;
}

export function PeopleJobsTab({
  db,
  locale,
  isOwner,
  actorId,
  onMsg,
  onRefresh,
}: {
  db: AppDatabase | null | undefined;
  locale: "en" | "hi";
  isOwner: boolean;
  actorId: string;
  onMsg: (msg: string) => void;
  onRefresh: () => void;
}) {
  const t = useTranslations("admin");
  const ownerOnly = new Set<Capability>(OWNER_ONLY_CAPABILITIES);
  const [draft, setDraft] = useState<RolePresets>(() => presetsFromDb(db));
  const [jobId, setJobId] = useState<string | null>(null);
  const [nameEn, setNameEn] = useState("");
  const [nameHi, setNameHi] = useState("");
  const [baseRole, setBaseRole] = useState<StaffJobBaseRole>("sales");
  const [jobCaps, setJobCaps] = useState<Capability[]>(() =>
    rolePresetCapabilities("sales", db?.rolePresets)
  );

  const [syncedPresets, setSyncedPresets] = useState(db?.rolePresets);
  if (db?.rolePresets !== syncedPresets) {
    setSyncedPresets(db?.rolePresets);
    setDraft(presetsFromDb(db));
  }

  const jobs = db?.staffJobs ?? [];

  const startNew = () => {
    setJobId(null);
    setNameEn("");
    setNameHi("");
    setBaseRole("sales");
    setJobCaps(rolePresetCapabilities("sales", db?.rolePresets));
  };

  const loadJob = (job: StaffJob) => {
    setJobId(job.id);
    setNameEn(job.name.en);
    setNameHi(job.name.hi);
    setBaseRole(job.baseRole);
    setJobCaps(
      effectiveCapabilities(
        {
          role: job.baseRole,
          extraCapabilities: job.extraCapabilities,
          deniedCapabilities: job.deniedCapabilities,
        },
        { rolePresets: db?.rolePresets }
      )
    );
  };

  const togglePreset = (role: StaffJobBaseRole, cap: Capability, on: boolean) => {
    if (!isOwner || ownerOnly.has(cap)) return;
    setDraft((cur) => {
      const set = new Set(cur[role] ?? []);
      if (on) set.add(cap);
      else set.delete(cap);
      return {
        ...cur,
        [role]: ALL_CAPABILITIES.filter((c) => set.has(c) && !ownerOnly.has(c)),
      };
    });
  };

  const onSavePresets = () => {
    if (!isOwner) return;
    try {
      saveRolePresets(draft, actorId);
      onMsg(t("peoplePresetsSaved"));
      onRefresh();
    } catch (err) {
      onMsg(err instanceof Error ? err.message : t("peoplePresetsSaved"));
    }
  };

  const onSaveJob = (e: FormEvent) => {
    e.preventDefault();
    if (!isOwner) return;
    const overrides = capabilityOverridesFromChecked(
      baseRole,
      jobCaps,
      db?.rolePresets
    );
    try {
      upsertStaffJob(
        {
          id: jobId || `job_${crypto.randomUUID()}`,
          name: { en: nameEn.trim(), hi: nameHi.trim() || nameEn.trim() },
          baseRole,
          extraCapabilities: overrides.extraCapabilities,
          deniedCapabilities: overrides.deniedCapabilities,
        },
        actorId
      );
      onMsg(t("peopleJobSaved"));
      startNew();
      onRefresh();
    } catch (err) {
      onMsg(err instanceof Error ? err.message : t("peopleJobSaved"));
    }
  };

  const onDeleteJob = (job: StaffJob) => {
    if (!isOwner) return;
    if (
      !window.confirm(
        t("peopleDeleteJobConfirm", { name: staffJobLabel(job, locale) })
      )
    ) {
      return;
    }
    try {
      deleteStaffJob(job.id, actorId);
      if (jobId === job.id) startNew();
      onMsg(t("peopleJobDeleted"));
      onRefresh();
    } catch (err) {
      onMsg(err instanceof Error ? err.message : t("peopleJobDeleted"));
    }
  };

  const assignedCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const u of db?.users ?? []) {
      if (!u.jobId) continue;
      map.set(u.jobId, (map.get(u.jobId) ?? 0) + 1);
    }
    return map;
  }, [db]);

  return (
    <div className="mt-5 space-y-5">
      {!isOwner ? (
        <p className="text-sm text-[var(--ink-muted)]">{t("peopleOwnerViewOnly")}</p>
      ) : null}

      <div className="tt-panel overflow-x-auto p-5">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 className="font-semibold">{t("peopleRoleDefaults")}</h2>
            <p className="text-xs text-[var(--ink-muted)]">
              {t("peopleRoleDefaultsHint")}
            </p>
          </div>
          {isOwner ? (
            <button
              type="button"
              className="tt-btn tt-btn-dark"
              onClick={onSavePresets}
            >
              {t("peopleSavePresets")}
            </button>
          ) : null}
        </div>
        <table className="tt-table min-w-[720px]">
          <thead>
            <tr>
              <th>{t("peoplePermissions")}</th>
              {JOB_BASE_ROLES.map((role) => (
                <th key={role} className="text-center">
                  {staffRoleLabel(role, locale)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ALL_CAPABILITIES.map((cap) => {
              const locked = ownerOnly.has(cap);
              return (
                <tr key={cap}>
                  <td>
                    {capabilityLabel(cap, locale)}
                    {locked ? (
                      <span className="ml-1 text-[10px] text-[var(--ink-muted)]">
                        ({t("peopleOwnerOnly")})
                      </span>
                    ) : null}
                  </td>
                  {JOB_BASE_ROLES.map((role) => (
                    <td key={role} className="text-center">
                      <input
                        type="checkbox"
                        checked={(draft[role] ?? []).includes(cap)}
                        disabled={!isOwner || locked}
                        onChange={(e) =>
                          togglePreset(role, cap, e.target.checked)
                        }
                      />
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <div className="tt-panel p-5">
          <h2 className="font-semibold">{t("peopleNamedJobs")}</h2>
          <p className="mt-1 text-xs text-[var(--ink-muted)]">
            {t("peopleJobsHint")}
          </p>
          <ul className="mt-3 space-y-2">
            {jobs.map((job) => (
              <li
                key={job.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 py-2"
              >
                <button
                  type="button"
                  className="text-left"
                  onClick={() => loadJob(job)}
                >
                  <p className="text-sm font-semibold text-[var(--brand)] underline-offset-2 hover:underline">
                    {staffJobLabel(job, locale)}
                  </p>
                  <p className="text-xs text-[var(--ink-muted)]">
                    {job.baseRole}
                    {assignedCounts.get(job.id)
                      ? ` · ${assignedCounts.get(job.id)}`
                      : ""}
                  </p>
                </button>
                {isOwner ? (
                  <button
                    type="button"
                    className="text-xs font-semibold text-[var(--danger)] underline underline-offset-2"
                    onClick={() => onDeleteJob(job)}
                  >
                    {t("peopleDeleteJob")}
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
          {!jobs.length ? (
            <p className="mt-3 text-sm text-[var(--ink-muted)]">
              {t("peopleNewJob")}
            </p>
          ) : null}
        </div>

        <form
          id="create-job-form"
          onSubmit={onSaveJob}
          className="tt-panel space-y-3 p-5"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-semibold">
              {jobId ? t("peopleSaveJob") : t("peopleNewJob")}
            </h2>
            {jobId ? (
              <button
                type="button"
                className="tt-btn tt-btn-outline"
                onClick={startNew}
              >
                {t("peopleNewJob")}
              </button>
            ) : null}
          </div>
          <input
            className="tt-input"
            placeholder={t("peopleJobNameEn")}
            value={nameEn}
            disabled={!isOwner}
            onChange={(e) => setNameEn(e.target.value)}
            required
          />
          <input
            className="tt-input"
            placeholder={t("peopleJobNameHi")}
            value={nameHi}
            disabled={!isOwner}
            onChange={(e) => setNameHi(e.target.value)}
          />
          <label className="block text-xs font-semibold text-[var(--ink-muted)]">
            {t("peopleCloneFrom")}
            <select
              className="tt-select mt-1"
              value={baseRole}
              disabled={!isOwner}
              onChange={(e) => {
                const next = e.target.value as StaffJobBaseRole;
                setBaseRole(next);
                setJobCaps(rolePresetCapabilities(next, db?.rolePresets));
              }}
            >
              {JOB_BASE_ROLES.map((role) => (
                <option key={role} value={role}>
                  {staffRoleLabel(role, locale)}
                </option>
              ))}
            </select>
          </label>
          <StaffPermissionsPanel
            role={baseRole}
            checked={jobCaps}
            locale={locale}
            disabled={!isOwner}
            presets={db?.rolePresets}
            onChange={setJobCaps}
          />
          <button
            type="submit"
            className="tt-btn tt-btn-dark"
            disabled={!isOwner}
          >
            {t("peopleSaveJob")}
          </button>
        </form>
      </div>
    </div>
  );
}
