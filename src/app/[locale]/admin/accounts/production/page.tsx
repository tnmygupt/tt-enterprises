"use client";

import { FormEvent, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/routing";
import { AdminAccessDenied } from "@/components/AdminAccessDenied";
import { AccountsEmpty } from "@/components/AccountsEmpty";
import { AccountsPageHeader } from "@/components/AccountsPageHeader";
import { AccountsShell } from "@/components/AccountsShell";
import { PageTabs } from "@/components/admin/PageTabs";
import { NumberField } from "@/components/NumberField";
import { SearchSelect } from "@/components/SearchSelect";
import { ACCT, accountBalance } from "@/lib/accounting";
import { toDateInputValue } from "@/lib/date-range";
import {
  catalogRowValue,
  inventoryRows,
  parseCatalogRowValue,
} from "@/lib/inventory";
import { loc } from "@/lib/localized";
import { useDb, useSession } from "@/lib/hooks";
import { formatInr } from "@/lib/pricing";
import {
  cancelIssuedJobCard,
  checkAnyCapability,
  checkCapability,
  completeJobCard,
  createJobCard,
  issueJobCard,
  replaceDbFromCloud,
  upsertBom,
} from "@/lib/store/db";
import type { BomLine, JobCardLine } from "@/lib/types";

type CatalogPick = {
  productId: string;
  variationId?: string;
  colorId?: string;
  qty: number;
};

function blankPick(): CatalogPick {
  return { productId: "", qty: 1 };
}

export default function ProductionPage() {
  const t = useTranslations("accounts");
  const locale = useLocale() as "en" | "hi";
  const { session } = useSession();
  const { db, refresh } = useDb();
  const canProduce = checkAnyCapability(session, db, [
    "manage_accounts",
    "manage_products",
    "manage_reorder",
  ]);
  const canSeeRupees =
    !!session &&
    (checkCapability(session, db, "manage_accounts") ||
      checkCapability(session, db, "view_financials"));

  const [tab, setTab] = useState<"jobs" | "bom">("jobs");
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const [outputKey, setOutputKey] = useState("");
  const [outputQty, setOutputQty] = useState("1");
  const [bomInputs, setBomInputs] = useState<CatalogPick[]>([blankPick()]);

  const [jobDate, setJobDate] = useState(toDateInputValue());
  const [jobBomId, setJobBomId] = useState("");
  const [jobPlanned, setJobPlanned] = useState("1");
  const [jobOutputKey, setJobOutputKey] = useState("");
  const [adhocInputs, setAdhocInputs] = useState<CatalogPick[]>([blankPick()]);
  const [actualQty, setActualQty] = useState<Record<string, string>>({});

  const catalog = useMemo(() => (db ? inventoryRows(db) : []), [db]);
  const catalogOptions = useMemo(
    () =>
      catalog.map((c) => ({
        value: catalogRowValue(c),
        label: `${c.sku} · ${c.name}`,
        searchText: `${c.sku} ${c.name} ${c.code}`,
      })),
    [catalog]
  );

  const boms = db?.boms ?? [];
  const jobs = db?.jobCards ?? [];
  const wip = useMemo(() => {
    if (!db || !canSeeRupees) return 0;
    const acct = db.accounts.find((a) => a.id === ACCT.wip);
    if (!acct) return 0;
    return accountBalance(acct, db.ledgerEntries);
  }, [db, canSeeRupees]);

  if (!session || !canProduce) {
    return (
      <AccountsShell>
        <AdminAccessDenied />
      </AccountsShell>
    );
  }

  const productLabel = (productId: string, variationId?: string) => {
    const p = db?.products.find((x) => x.id === productId);
    if (!p) return productId;
    const v = variationId
      ? p.variations.find((x) => x.id === variationId)
      : undefined;
    return [loc(p.name, locale), v ? loc(v.label, locale) : ""]
      .filter(Boolean)
      .join(" · ");
  };

  const parsePick = (key: string): Omit<CatalogPick, "qty"> => {
    const parsed = parseCatalogRowValue(key);
    return {
      productId: parsed.productId,
      variationId: parsed.variationId || undefined,
      colorId: parsed.colorId || undefined,
    };
  };

  const runLocal = (body: Record<string, unknown>) => {
    const createdBy = session.id;
    const action = String(body.action || "");
    if (action === "upsertBom") {
      upsertBom({
        outputProductId: String(body.outputProductId || ""),
        outputVariationId: body.outputVariationId
          ? String(body.outputVariationId)
          : undefined,
        outputColorId: body.outputColorId
          ? String(body.outputColorId)
          : undefined,
        outputQty: Number(body.outputQty) || 0,
        lines: (body.lines as Omit<BomLine, "id">[]) || [],
        createdBy,
      });
    } else if (action === "createJob") {
      createJobCard({
        date: String(body.date || toDateInputValue()),
        createdBy,
        bomId: body.bomId ? String(body.bomId) : undefined,
        outputProductId: String(body.outputProductId || ""),
        outputVariationId: body.outputVariationId
          ? String(body.outputVariationId)
          : undefined,
        outputColorId: body.outputColorId
          ? String(body.outputColorId)
          : undefined,
        plannedQty: Number(body.plannedQty) || 0,
        inputLines: body.inputLines as Omit<JobCardLine, "itemLabel">[] | undefined,
      });
    } else if (action === "issue") {
      issueJobCard(String(body.jobId || ""), createdBy);
    } else if (action === "complete") {
      completeJobCard({
        jobId: String(body.jobId || ""),
        actualQty: Number(body.actualQty) || 0,
        createdBy,
      });
    } else if (action === "cancelIssue") {
      cancelIssuedJobCard(String(body.jobId || ""), createdBy);
    } else {
      throw new Error("Unknown action");
    }
  };

  const mutate = async (body: Record<string, unknown>, okMsg: string) => {
    setBusy(true);
    setError("");
    setMsg("");
    try {
      const res = await fetch("/api/production", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.status === 503) {
        const action = String(body.action || "");
        const booksOnClient = (db?.vouchers?.length ?? 0) > 0;
        if (
          !booksOnClient &&
          (action === "issue" ||
            action === "complete" ||
            action === "cancelIssue")
        ) {
          throw new Error(
            locale === "hi"
              ? "क्लाउड बंद है — जॉब इश्यू/पूरा किताबों के बिना नहीं हो सकता"
              : "Cloud unavailable — cannot issue or complete jobs without books"
          );
        }
        runLocal(body);
        refresh();
        setMsg(okMsg);
        return;
      }
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error || "Failed");
      const { repullForSession } = await import("@/lib/supabase/sync");
      const remote = await repullForSession();
      if (remote) replaceDbFromCloud(remote);
      refresh();
      setMsg(okMsg);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setBusy(false);
    }
  };

  const onSaveBom = (e: FormEvent) => {
    e.preventDefault();
    const out = parsePick(outputKey);
    if (!out.productId) {
      setError("Pick a finished SKU");
      return;
    }
    const lines = bomInputs
      .filter((l) => l.productId && l.qty > 0)
      .map((l) => ({
        productId: l.productId,
        variationId: l.variationId,
        colorId: l.colorId,
        qty: l.qty,
      }));
    void mutate(
      {
        action: "upsertBom",
        outputProductId: out.productId,
        outputVariationId: out.variationId,
        outputColorId: out.colorId,
        outputQty: Number(outputQty) || 0,
        lines,
      },
      t("saveBom")
    );
  };

  const onCreateJob = (e: FormEvent) => {
    e.preventDefault();
    const bom = jobBomId
      ? boms.find((b) => b.id === jobBomId)
      : undefined;
    const out = bom
      ? {
          productId: bom.outputProductId,
          variationId: bom.outputVariationId,
          colorId: bom.outputColorId,
        }
      : parsePick(jobOutputKey);
    if (!out.productId) {
      setError("Pick a finished SKU or BOM");
      return;
    }
    const inputLines = !jobBomId
      ? adhocInputs
          .filter((l) => l.productId && l.qty > 0)
          .map((l) => ({
            productId: l.productId,
            variationId: l.variationId,
            colorId: l.colorId,
            qty: l.qty,
            bundles: 0,
          }))
      : undefined;
    void mutate(
      {
        action: "createJob",
        date: jobDate,
        bomId: jobBomId || undefined,
        outputProductId: out.productId,
        outputVariationId: out.variationId,
        outputColorId: out.colorId,
        plannedQty: Number(jobPlanned) || 0,
        inputLines,
      },
      t("newJob")
    );
  };

  const jobStatus = (status: string) => {
    if (status === "draft") return t("jobDraft");
    if (status === "issued") return t("jobIssued");
    if (status === "completed") return t("jobCompleted");
    if (status === "cancelled") return t("jobCancelled");
    return status;
  };

  return (
    <AccountsShell>
      <AccountsPageHeader title={t("production")} hint={t("productionHint")} />

      {canSeeRupees ? (
        <p className="mt-3 text-sm text-[var(--ink-muted)]">
          {t("wipBalance")}:{" "}
          <strong className="tabular-nums text-[var(--brand-deep)]">
            {formatInr(wip, locale)}
          </strong>
        </p>
      ) : null}

      {msg ? <p className="mt-3 text-sm text-[var(--ok)]">{msg}</p> : null}
      {error ? (
        <p className="mt-3 text-sm text-[var(--danger)]">{error}</p>
      ) : null}

      <PageTabs
        className="mt-4"
        value={tab}
        onChange={(id) => setTab(id as "jobs" | "bom")}
        tabs={[
          { id: "jobs", label: t("jobCards") },
          { id: "bom", label: t("bom") },
        ]}
      />
      <div className="mt-3 flex flex-wrap gap-2 print:hidden">
        <Link href="/admin/accounts/inventory" className="tt-btn tt-btn-outline">
          {t("stock")}
        </Link>
      </div>

      {tab === "bom" ? (
        <>
          <form
            onSubmit={onSaveBom}
            className="tt-panel mt-5 grid max-w-3xl gap-3 p-5 sm:grid-cols-2"
          >
            <p className="sm:col-span-2 text-xs font-bold uppercase tracking-wide text-[var(--ink-muted)]">
              {t("newBom")}
            </p>
            <div className="sm:col-span-2">
              <label className="tt-label">{t("outputProduct")}</label>
              <SearchSelect
                options={catalogOptions}
                value={outputKey}
                onChange={setOutputKey}
                placeholder={t("outputProduct")}
                required
              />
            </div>
            <div>
              <label className="tt-label">{t("outputQty")}</label>
              <NumberField
                className="tt-input"
                min={0}
                value={outputQty}
                onValueChange={(v) => setOutputQty(v === "" ? "" : String(v))}
              />
            </div>
            <p className="sm:col-span-2 text-xs font-bold uppercase tracking-wide text-[var(--ink-muted)]">
              {t("inputLines")}
            </p>
            {bomInputs.map((line, i) => (
              <div key={i} className="sm:col-span-2 grid gap-2 sm:grid-cols-[1fr_120px]">
                <SearchSelect
                  options={catalogOptions}
                  value={
                    line.productId
                      ? catalogRowValue({
                          productId: line.productId,
                          variationId: line.variationId,
                          colorId: line.colorId,
                        })
                      : ""
                  }
                  onChange={(val) => {
                    const next = [...bomInputs];
                    next[i] = { ...next[i]!, ...parsePick(val), qty: line.qty };
                    setBomInputs(next);
                  }}
                  placeholder={t("inputLines")}
                />
                <NumberField
                  className="tt-input"
                  min={0}
                  value={line.qty}
                  onValueChange={(v) => {
                    const next = [...bomInputs];
                    next[i] = { ...next[i]!, qty: Number(v) || 0 };
                    setBomInputs(next);
                  }}
                />
              </div>
            ))}
            <button
              type="button"
              className="tt-btn tt-btn-outline sm:col-span-2"
              onClick={() => setBomInputs([...bomInputs, blankPick()])}
            >
              + {t("inputLines")}
            </button>
            <button
              type="submit"
              className="tt-btn tt-btn-dark sm:col-span-2"
              disabled={busy}
            >
              {t("saveBom")}
            </button>
          </form>

          <div className="tt-panel mt-6 tt-acct-table-wrap">
            <table className="tt-table min-w-[640px]">
              <thead>
                <tr>
                  <th>{t("outputProduct")}</th>
                  <th>{t("outputQty")}</th>
                  <th>{t("inputLines")}</th>
                </tr>
              </thead>
              <tbody>
                {boms.map((bom) => (
                  <tr key={bom.id}>
                    <td>{productLabel(bom.outputProductId, bom.outputVariationId)}</td>
                    <td className="tabular-nums">{bom.outputQty}</td>
                    <td className="text-sm">
                      {bom.lines
                        .map(
                          (l) =>
                            `${productLabel(l.productId, l.variationId)} × ${l.qty}`
                        )
                        .join(" · ")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!boms.length ? (
              <AccountsEmpty message={t("noBoms")} href="#new-bom" cta={t("newBom")} />
            ) : null}
          </div>
        </>
      ) : (
        <>
          <form
            onSubmit={onCreateJob}
            className="tt-panel mt-5 grid max-w-3xl gap-3 p-5 sm:grid-cols-2"
          >
            <p className="sm:col-span-2 text-xs font-bold uppercase tracking-wide text-[var(--ink-muted)]">
              {t("newJob")}
            </p>
            <div>
              <label className="tt-label">{t("pickBom")}</label>
              <select
                className="tt-select"
                value={jobBomId}
                onChange={(e) => setJobBomId(e.target.value)}
              >
                <option value="">{t("adHocJob")}</option>
                {boms
                  .filter((b) => b.active)
                  .map((b) => (
                    <option key={b.id} value={b.id}>
                      {productLabel(b.outputProductId, b.outputVariationId)} ·{" "}
                      {b.outputQty}
                    </option>
                  ))}
              </select>
            </div>
            <div>
              <label className="tt-label">{t("colDate")}</label>
              <input
                type="date"
                className="tt-input"
                value={jobDate}
                onChange={(e) => setJobDate(e.target.value)}
              />
            </div>
            {!jobBomId ? (
              <div className="sm:col-span-2">
                <label className="tt-label">{t("outputProduct")}</label>
                <SearchSelect
                  options={catalogOptions}
                  value={jobOutputKey}
                  onChange={setJobOutputKey}
                  placeholder={t("outputProduct")}
                />
              </div>
            ) : null}
            <div>
              <label className="tt-label">{t("plannedQty")}</label>
              <NumberField
                className="tt-input"
                min={0}
                value={jobPlanned}
                onValueChange={(v) => setJobPlanned(v === "" ? "" : String(v))}
              />
            </div>
            {!jobBomId ? (
              <>
                <p className="sm:col-span-2 text-xs font-bold uppercase tracking-wide text-[var(--ink-muted)]">
                  {t("inputLines")}
                </p>
                {adhocInputs.map((line, i) => (
                  <div
                    key={i}
                    className="sm:col-span-2 grid gap-2 sm:grid-cols-[1fr_120px]"
                  >
                    <SearchSelect
                      options={catalogOptions}
                      value={
                        line.productId
                          ? catalogRowValue({
                              productId: line.productId,
                              variationId: line.variationId,
                              colorId: line.colorId,
                            })
                          : ""
                      }
                      onChange={(val) => {
                        const next = [...adhocInputs];
                        next[i] = {
                          ...next[i]!,
                          ...parsePick(val),
                          qty: line.qty,
                        };
                        setAdhocInputs(next);
                      }}
                      placeholder={t("inputLines")}
                    />
                    <NumberField
                      className="tt-input"
                      min={0}
                      value={line.qty}
                      onValueChange={(v) => {
                        const next = [...adhocInputs];
                        next[i] = { ...next[i]!, qty: Number(v) || 0 };
                        setAdhocInputs(next);
                      }}
                    />
                  </div>
                ))}
                <button
                  type="button"
                  className="tt-btn tt-btn-outline sm:col-span-2"
                  onClick={() => setAdhocInputs([...adhocInputs, blankPick()])}
                >
                  + {t("inputLines")}
                </button>
              </>
            ) : null}
            <button
              type="submit"
              className="tt-btn tt-btn-dark sm:col-span-2"
              disabled={busy}
            >
              {t("newJob")}
            </button>
          </form>

          <div className="tt-panel mt-6 tt-acct-table-wrap">
            <table className="tt-table min-w-[720px]">
              <thead>
                <tr>
                  <th>No.</th>
                  <th>{t("outputProduct")}</th>
                  <th>{t("plannedQty")}</th>
                  <th>{t("actualQty")}</th>
                  <th>{t("colDate")}</th>
                  {canSeeRupees ? <th>{t("wipBalance")}</th> : null}
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((job) => (
                  <tr key={job.id}>
                    <td className="font-mono text-sm">
                      {job.number}
                      <div className="text-xs text-[var(--ink-muted)]">
                        {jobStatus(job.status)}
                      </div>
                    </td>
                    <td>
                      {productLabel(job.outputProductId, job.outputVariationId)}
                    </td>
                    <td className="tabular-nums">{job.plannedQty}</td>
                    <td className="tabular-nums">{job.actualQty ?? "—"}</td>
                    <td>{job.date}</td>
                    {canSeeRupees ? (
                      <td className="tabular-nums text-sm">
                        {job.issuedCost != null
                          ? formatInr(job.issuedCost, locale)
                          : "—"}
                        {job.wastageCost
                          ? ` · ${formatInr(job.wastageCost, locale)}`
                          : ""}
                      </td>
                    ) : null}
                    <td>
                      <div className="flex flex-wrap items-center gap-2">
                        {job.status === "draft" ? (
                          <button
                            type="button"
                            className="tt-btn tt-btn-dark"
                            disabled={busy}
                            onClick={() =>
                              void mutate(
                                { action: "issue", jobId: job.id },
                                t("issueJob")
                              )
                            }
                          >
                            {t("issueJob")}
                          </button>
                        ) : null}
                        {job.status === "issued" ? (
                          <>
                            <NumberField
                              className="tt-input w-24"
                              min={0}
                              value={actualQty[job.id] ?? String(job.plannedQty)}
                              onValueChange={(v) =>
                                setActualQty((cur) => ({
                                  ...cur,
                                  [job.id]: v === "" ? "" : String(v),
                                }))
                              }
                            />
                            <button
                              type="button"
                              className="tt-btn tt-btn-dark"
                              disabled={busy}
                              onClick={() =>
                                void mutate(
                                  {
                                    action: "complete",
                                    jobId: job.id,
                                    actualQty:
                                      Number(
                                        actualQty[job.id] ?? job.plannedQty
                                      ) || 0,
                                  },
                                  t("completeJob")
                                )
                              }
                            >
                              {t("completeJob")}
                            </button>
                            <button
                              type="button"
                              className="tt-btn tt-btn-outline"
                              disabled={busy}
                              onClick={() =>
                                void mutate(
                                  { action: "cancelIssue", jobId: job.id },
                                  t("cancelJob")
                                )
                              }
                            >
                              {t("cancelJob")}
                            </button>
                          </>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!jobs.length ? (
              <AccountsEmpty
                message={t("noJobs")}
                href="#new-job"
                cta={t("newJob")}
              />
            ) : null}
          </div>
        </>
      )}
    </AccountsShell>
  );
}
