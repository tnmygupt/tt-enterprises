"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { TransportInput } from "@/components/TransportInput";
import { useLocale, useTranslations } from "next-intl";
import { useParams } from "next/navigation";
import { Link } from "@/i18n/routing";
import { AdminAccessDenied } from "@/components/AdminAccessDenied";
import { AdminShell } from "@/components/AdminShell";
import { BackToBooksBar } from "@/components/AccountsShell";
import { NumberField } from "@/components/NumberField";
import { useDb, useSession } from "@/lib/hooks";
import { StaffBillDiscountFields } from "@/components/StaffBillDiscountFields";
import { formatInr, roundMoney } from "@/lib/pricing";
import {
  notifyPackingSlipFinalizedWhatsApp,
  notifyPackingSlipWhatsApp,
  whatsappResultCopy,
} from "@/lib/whatsapp";
import {
  attachPackingSlipPdf,
  calcShipping,
  countOrderJhals,
  ensurePackingSlip,
  finalizePackingSlip,
  checkCapability,
  refreshPackingSlipFromOrder,
  reopenPackingSlip,
  savePackingSlipDraft,
} from "@/lib/store/db";
import {
  columnBundles,
  columnKgTotals,
  columnRateLabel,
  computeBillFromSlip,
  grandBundles,
  grandKg,
  normalizePackingSlip,
  parseKgInput,
  shippingWeightFromSlip,
  syncBundlesFromCells,
} from "@/lib/packing-slip";
import { companyFromSettings } from "@/lib/export-pdf";
import {
  buildPackingSlipPdfBlob,
  buildPackingSlipPdfDataUrl,
  downloadPackingSlipPdf,
} from "@/lib/packing-slip-pdf";
import { uploadMediaFile } from "@/lib/upload-media";
import {
  applyBillDiscounts,
  orderDiscountMathLabel,
  orderDiscountMathQty,
  orderDiscountReceiptLabel,
  pickBestOrderDiscount,
  type ManualDiscountKind,
} from "@/lib/schemes";
import type { Order, PackingSlip } from "@/lib/types";

export default function AdminPackingSlipPage() {
  const t = useTranslations();
  const locale = useLocale() as "en" | "hi";
  const params = useParams<{ id: string }>();
  const { session } = useSession();
  const { db, refresh } = useDb();
  const order = db?.orders.find((o) => o.id === params.id);

  const [slip, setSlip] = useState<PackingSlip | null>(null);
  /** Keep decimal typing like "12." without jumping to "12" */
  const [cellDrafts, setCellDrafts] = useState<Record<string, string>>({});
  const [shippingDraft, setShippingDraft] = useState("");
  const [discKind, setDiscKind] = useState<ManualDiscountKind | "">("");
  const [discValue, setDiscValue] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmFinalize, setConfirmFinalize] = useState(false);
  const [allowOverCredit, setAllowOverCredit] = useState(false);
  const sheetRef = useRef<HTMLDivElement>(null);

  const canManage =
    !!session && checkCapability(session, db, "manage_orders");

  useEffect(() => {
    if (!order || !canManage) return;
    try {
      const beforeShip = order.packingSlip?.shippingAmount;
      const beforeStatus = order.packingSlip?.status;
      const ensured = ensurePackingSlip(order.id);
      const normalized = normalizePackingSlip(
        ensured,
        ensured.packingSlip!
      );
      // Hydrating local slip draft from the store — intentional
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSlip((prev) => {
        if (
          prev &&
          prev.slipNo === normalized.slipNo &&
          prev.status === normalized.status &&
          prev.finalizedAt === normalized.finalizedAt &&
          prev.rows.length === normalized.rows.length &&
          prev.shippingAmount === normalized.shippingAmount &&
          prev.columns.length === normalized.columns.length
        ) {
          return prev;
        }
        return structuredClone(normalized);
      });
      // Only refresh db subscription when ensure/normalize actually wrote
      const wrote =
        beforeStatus !== ensured.packingSlip?.status ||
        beforeShip !== ensured.packingSlip?.shippingAmount ||
        !beforeStatus;
      if (wrote) refresh();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Failed to load slip");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- hydrate on order/slip status
  }, [
    order?.id,
    order?.packingSlip?.status,
    order?.packingSlip?.finalizedAt,
    canManage,
  ]);

  const kgTotals = useMemo(
    () => (slip ? columnKgTotals(slip) : []),
    [slip]
  );
  const bundleTotals = useMemo(
    () => (slip ? columnBundles(slip) : []),
    [slip]
  );
  const totalKg = useMemo(() => (slip ? grandKg(slip) : 0), [slip]);
  const totalBundles = useMemo(
    () => (slip ? grandBundles(slip) : 0),
    [slip]
  );

  /** Subtotal from weighments (shipping excluded) — drives auto shipping. */
  const subtotalOnly = useMemo(() => {
    if (!order || !slip) return 0;
    return computeBillFromSlip(order, slip, { shippingAmount: 0 }).subtotal;
  }, [order, slip]);

  const autoShipping = useMemo(() => {
    if (!db || !order || !slip) return 0;
    const jhalQty = countOrderJhals(order.lines, db.products);
    const shipWeight = shippingWeightFromSlip(order, slip, db.products);
    if (!(shipWeight > 0) && !(subtotalOnly > 0) && !(jhalQty > 0)) {
      return roundMoney(order.shippingAmount || 0);
    }
    return calcShipping(db, subtotalOnly, shipWeight, jhalQty);
  }, [db, order, slip, subtotalOnly]);

  /** Keep auto shipping on the slip unless staff overrode it. */
  useEffect(() => {
    if (!slip || slip.status === "finalized") return;
    if (slip.shippingManual) return;
    const next = roundMoney(autoShipping);
    if (roundMoney(Number(slip.shippingAmount) || 0) === next) return;
    // Auto shipping recalculation writes back to the draft — intentional
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSlip((prev) =>
      prev
        ? {
            ...prev,
            shippingAmount: next,
            shippingManual: false,
          }
        : prev
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when auto ship or override flag changes
  }, [
    autoShipping,
    slip?.status,
    slip?.shippingManual,
    slip?.shippingAmount,
  ]);

  const effectiveShipping = useMemo(() => {
    if (!slip) return 0;
    if (slip.shippingManual) {
      return roundMoney(Math.max(0, Number(slip.shippingAmount) || 0));
    }
    return autoShipping;
  }, [slip, autoShipping]);

  useEffect(() => {
    if (!order) return;
    // Hydrate staff override from the saved order
    /* eslint-disable react-hooks/set-state-in-effect */
    setDiscKind(order.manualDiscountKind || "");
    setDiscValue(
      order.manualDiscountValue != null ? String(order.manualDiscountValue) : ""
    );
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [order?.id, order?.manualDiscountKind, order?.manualDiscountValue]);

  const preview = useMemo(() => {
    if (!order || !slip || !db) return null;
    const base = computeBillFromSlip(order, slip, {
      shippingAmount: effectiveShipping,
      schemeDiscount: 0,
    });
    const kgTotals =
      slip.columns.length === order.lines.length
        ? columnKgTotals(slip)
        : order.lines.map(() => 0);
    const slipKg = roundMoney(kgTotals.reduce((s, n) => s + (Number(n) || 0), 0));
    const bundles = columnBundles(slip);
    const linesForDisc = order.lines.map((line, i) => ({
      ...line,
      lineTotal: base.lineAmounts[i] ?? line.lineTotal,
      actualWeightKg: kgTotals[i] || 0,
      estimatedWeightKg: 0,
      weightKg: kgTotals[i] || 0,
      quantity:
        line.pricingMode === "pcs" && (bundles[i] || 0) > 0
          ? bundles[i]
          : line.quantity,
    }));
    const dealer = db.users.find((u) => u.id === order.userId);
    const billedOpts = { billedOnly: true } as const;
    const best =
      slipKg > 0
        ? pickBestOrderDiscount(
            db.schemes,
            dealer?.assignedSchemeIds,
            linesForDisc,
            db.products,
            undefined,
            billedOpts
          )
        : null;
    const applied = applyBillDiscounts({
      goodsSubtotal: base.subtotal,
      schemeAmount: best?.amount ?? 0,
      manualKind: discKind,
      manualValue: Number(discValue) || 0,
    });
    const discQty = best
      ? orderDiscountMathQty(best.scheme, linesForDisc, db.products, billedOpts)
      : 0;
    return {
      ...computeBillFromSlip(order, slip, {
        shippingAmount: effectiveShipping,
        schemeDiscount: applied.total,
      }),
      schemeAuto: applied.schemeAmount,
      schemeBest: best,
      staffExtra: applied.manualAmount,
      discountMath: orderDiscountMathLabel(best, discQty, locale),
      weighed: slipKg > 0,
    };
  }, [order, slip, effectiveShipping, db, discKind, discValue, locale]);

  useEffect(() => {
    if (!slip) return;
    // Text input mirrors the resolved shipping value — intentional
    /* eslint-disable react-hooks/set-state-in-effect */
    if (slip.shippingManual) {
      setShippingDraft(
        slip.shippingAmount != null ? String(slip.shippingAmount) : ""
      );
    } else {
      setShippingDraft(String(autoShipping));
    }
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [slip?.shippingManual, slip?.shippingAmount, autoShipping, slip]);

  if (!session || !canManage) {
    return (
      <AdminShell>
        <AdminAccessDenied />
      </AdminShell>
    );
  }

  if (!db || !order) {
    return (
      <AdminShell>
        <p className="text-[var(--ink-muted)]">{t("common.loading")}</p>
        <Link href="/admin/orders" className="tt-btn tt-btn-outline mt-4">
          {locale === "hi" ? "ऑर्डर सूची" : "Orders"}
        </Link>
      </AdminShell>
    );
  }

  if (!slip) {
    return (
      <AdminShell>
        <p className="text-[var(--ink-muted)]">{t("common.loading")}</p>
      </AdminShell>
    );
  }

  const locked = slip.status === "finalized";
  const hi = locale === "hi";
  const rowCount = slip.rows.length;
  const bdlWord = hi ? "बंडल" : "bdl";

  // A5 fits about six weighment columns. Beyond that the grid used to run off
  // the sheet and the extra products simply never printed, so split it into
  // stacked blocks instead. Each entry keeps its original column index because
  // the cell helpers and keyboard nav are all indexed against slip.columns.
  const COLUMNS_PER_BLOCK = 6;
  const columnBlocks: { col: (typeof slip.columns)[number]; index: number }[][] =
    [];
  slip.columns.forEach((col, index) => {
    const block = Math.floor(index / COLUMNS_PER_BLOCK);
    (columnBlocks[block] ??= []).push({ col, index });
  });

  const cellKey = (r: number, c: number) => `${r}:${c}`;

  const isCellActive = (r: number, c: number) => {
    const ordered = slip.columns[c]?.orderedBundles ?? rowCount;
    return r < ordered;
  };

  /** Move focus with arrow keys across active weighment cells. */
  const focusCell = (r: number, c: number) => {
    const el = document.querySelector<HTMLInputElement>(
      `[data-slip-cell="${r}-${c}"]`
    );
    if (!el || el.disabled) return false;
    el.focus();
    el.select();
    return true;
  };

  const findNextCell = (
    r: number,
    c: number,
    dr: number,
    dc: number
  ): { r: number; c: number } | null => {
    let nr = r + dr;
    let nc = c + dc;
    for (let i = 0; i < rowCount * slip.columns.length + 2; i++) {
      if (nr < 0 || nr >= rowCount || nc < 0 || nc >= slip.columns.length) {
        return null;
      }
      if (isCellActive(nr, nc)) return { r: nr, c: nc };
      nr += dr;
      nc += dc;
    }
    return null;
  };

  const onCellKeyDown = (
    e: KeyboardEvent<HTMLInputElement>,
    r: number,
    c: number
  ) => {
    let dr = 0;
    let dc = 0;
    if (e.key === "ArrowUp") dr = -1;
    else if (e.key === "ArrowDown") dr = 1;
    else if (e.key === "ArrowLeft") dc = -1;
    else if (e.key === "ArrowRight") dc = 1;
    else if (e.key === "Enter") {
      e.preventDefault();
      dr = e.shiftKey ? -1 : 1;
    } else return;

    // Left/right: only jump when caret is at edge (or empty), so typing decimals works
    if (dc !== 0) {
      const input = e.currentTarget;
      const start = input.selectionStart ?? 0;
      const end = input.selectionEnd ?? 0;
      const len = input.value.length;
      const allSelected = start === 0 && end === len && len > 0;
      if (!allSelected) {
        if (dc < 0 && start > 0) return;
        if (dc > 0 && end < len) return;
      }
    }

    const next = findNextCell(r, c, dr, dc);
    if (!next) return;
    e.preventDefault();
    focusCell(next.r, next.c);
  };

  const onPrint = () => {
    document.body.classList.add("packing-slip-printing");
    const cleanup = () => {
      document.body.classList.remove("packing-slip-printing");
      window.removeEventListener("afterprint", cleanup);
    };
    window.addEventListener("afterprint", cleanup);
    window.print();
    window.setTimeout(cleanup, 1500);
  };

  const publishPackingSlipPdfUrl = async (source: Order): Promise<string> => {
    const filename = `${source.orderNumber}-packing-slip.pdf`;
    const blob = buildPackingSlipPdfBlob(
      source,
      locale,
      companyFromSettings(db?.settings)
    );
    const file = new File([blob], filename, { type: "application/pdf" });
    const uploaded = await uploadMediaFile(file, "bills");
    const url = uploaded.url || "";
    if (/^https:\/\//i.test(url)) return url;
    if (url.startsWith("/") && window.location.origin.startsWith("https://")) {
      return `${window.location.origin}${url}`;
    }
    throw new Error(
      hi
        ? "PDF अपलोड नहीं हुआ — WhatsApp में फ़ाइल नहीं जा सकती"
        : "Could not upload PDF — WhatsApp cannot attach the file"
    );
  };

  const onWhatsAppPdf = async () => {
    if (!db || !order) return;
    const phone = order.phone || db.users.find((u) => u.id === order.userId)?.phone;
    if (!phone) {
      setMsg(
        hi ? "डिलर फ़ोन नहीं मिला" : "Dealer phone missing"
      );
      return;
    }
    setBusy(true);
    setMsg("");
    try {
      let pdfUrl = order.packingSlip?.customerPdfUrl || "";
      if (!/^https:\/\//i.test(pdfUrl)) {
        pdfUrl = await publishPackingSlipPdfUrl(order);
        attachPackingSlipPdf(order.id, pdfUrl);
        refresh();
      }
      const wa = await notifyPackingSlipWhatsApp({
        phone,
        partyName: order.checkoutName || order.userName || "Dealer",
        voucherNumber: order.orderNumber,
        settings: db.settings,
        locale,
        orderNumber: order.orderNumber,
        orderId: order.id,
        packingSlipDataUrl: pdfUrl,
        packingSlipName: `${order.orderNumber}-packing-slip.pdf`,
        audience: "customer",
        discountAmount: order.schemeDiscount,
        discountLabel: order.schemeDiscountLabel,
        billAmount: order.actualBillAmount,
        order,
      });
      setMsg(
        whatsappResultCopy(wa, {
          sent: t("common.whatsappSent"),
          opened: t("common.whatsappOpened"),
          fail: t("common.whatsappSendFailed"),
          noPhone: t("common.whatsappNoPhone"),
        }) +
          (wa.attached
            ? hi
              ? " · PDF और पेमेंट QR WhatsApp पर गए"
              : " · PDF and payment QR sent on WhatsApp"
            : "")
      );
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "WhatsApp PDF failed");
    } finally {
      setBusy(false);
    }
  };

  const onDownloadPdf = () => {
    // Start PDF open/share BEFORE any React setState so iOS still treats it
    // as a user gesture (setBusy would break Safari window.open / share).
    let pending: Promise<void>;
    try {
      pending = downloadPackingSlipPdf(
        order,
        locale,
        companyFromSettings(db?.settings)
      );
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "PDF failed");
      return;
    }
    setBusy(true);
    void pending
      .catch((err) => {
        setMsg(err instanceof Error ? err.message : "PDF failed");
      })
      .finally(() => setBusy(false));
  };

  const withShipping = (next: PackingSlip): PackingSlip => {
    const synced = syncBundlesFromCells(next);
    if (synced.shippingManual) return synced;
    const sub = computeBillFromSlip(order, synced, {
      shippingAmount: 0,
    }).subtotal;
    const jhalQty = countOrderJhals(order.lines, db.products);
    const kg = shippingWeightFromSlip(order, synced, db.products);
    const ship = calcShipping(db, sub, kg, jhalQty);
    return { ...synced, shippingAmount: ship, shippingManual: false };
  };

  const setCell = (r: number, c: number, raw: string) => {
    if (locked) return;
    const { value, display } = parseKgInput(raw);
    setCellDrafts((d) => ({ ...d, [cellKey(r, c)]: display }));
    setSlip((prev) => {
      if (!prev) return prev;
      const next = structuredClone(prev);
      while (next.rows.length <= r) {
        next.rows.push({
          cells: Array.from({ length: next.columns.length }, () => null),
        });
      }
      next.rows[r].cells[c] = value;
      return withShipping(next);
    });
  };

  const cellDisplay = (r: number, c: number): string => {
    const key = cellKey(r, c);
    if (cellDrafts[key] != null) return cellDrafts[key];
    const v = slip.rows[r]?.cells[c];
    return v == null ? "" : String(v);
  };

  const persistSlip = (s: PackingSlip) => {
    const next = {
      ...syncBundlesFromCells(s),
      shippingAmount: s.shippingManual
        ? roundMoney(Math.max(0, Number(s.shippingAmount) || 0))
        : autoShipping,
    };
    if (!s.shippingManual) {
      const jhalQty = countOrderJhals(order.lines, db.products);
      const kg = shippingWeightFromSlip(order, next, db.products);
      next.shippingAmount = calcShipping(
        db,
        computeBillFromSlip(order, next, { shippingAmount: 0 }).subtotal,
        kg,
        jhalQty
      );
      next.shippingManual = false;
    }
    return next;
  };

  /** Commit in-progress cell typing (critical on mobile before finalize). */
  const flushCellDrafts = (s: PackingSlip): PackingSlip => {
    if (typeof document !== "undefined") {
      const active = document.activeElement as HTMLElement | null;
      active?.blur?.();
    }
    const next = structuredClone(s);
    for (const [key, display] of Object.entries(cellDrafts)) {
      const [rs, cs] = key.split(":");
      const r = Number(rs);
      const c = Number(cs);
      if (!Number.isFinite(r) || !Number.isFinite(c)) continue;
      const { value } = parseKgInput(display);
      while (next.rows.length <= r) {
        next.rows.push({
          cells: Array.from({ length: next.columns.length }, () => null),
        });
      }
      while (next.rows[r].cells.length <= c) next.rows[r].cells.push(null);
      next.rows[r].cells[c] = value;
    }
    return withShipping(next);
  };

  const onSave = () => {
    try {
      const ready = flushCellDrafts(slip);
      const saved = savePackingSlipDraft(order.id, persistSlip(ready), {
        manualDiscountKind:
          discKind === "percent" || discKind === "flat" ? discKind : undefined,
        manualDiscountValue:
          discKind && Number(discValue) > 0 ? Number(discValue) : undefined,
      });
      setSlip(structuredClone(saved.packingSlip!));
      setCellDrafts({});
      setMsg(hi ? "ड्राफ्ट सेव हो गया" : "Draft saved");
      refresh();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Save failed");
    }
  };

  const runFinalize = async () => {
    if (!session?.id) {
      setMsg(
        hi ? "सेशन नहीं मिला — फिर लॉगिन करें" : "Session missing — log in again"
      );
      return;
    }
    setBusy(true);
    setConfirmFinalize(false);
    setMsg("");
    try {
      const ready = flushCellDrafts(slip);
      setSlip(ready);
      savePackingSlipDraft(order.id, persistSlip(ready), {
        manualDiscountKind:
          discKind === "percent" || discKind === "flat" ? discKind : undefined,
        manualDiscountValue:
          discKind && Number(discValue) > 0 ? Number(discValue) : undefined,
      });
      const done = finalizePackingSlip(order.id, session.id, {
        preparedBy: ready.preparedBy,
        checkedBy: ready.checkedBy,
        manualDiscountKind:
          discKind === "percent" || discKind === "flat" ? discKind : undefined,
        manualDiscountValue:
          discKind && Number(discValue) > 0 ? Number(discValue) : undefined,
        allowOverCredit,
      });
      let billed = done;
      try {
        let pdfUrl = "";
        try {
          pdfUrl = await publishPackingSlipPdfUrl(billed);
        } catch (uploadErr) {
          console.warn("[packing-slip] PDF upload skipped", uploadErr);
        }
        if (!pdfUrl) {
          pdfUrl = buildPackingSlipPdfDataUrl(
            billed,
            locale,
            companyFromSettings(db?.settings)
          );
        }
        billed = attachPackingSlipPdf(order.id, pdfUrl);
      } catch (pdfErr) {
        console.warn("[packing-slip] PDF attach skipped", pdfErr);
      }
      try {
        if (!db) throw new Error("missing db");
        const wa = await notifyPackingSlipFinalizedWhatsApp({
          order: billed,
          settings: db.settings,
          users: db.users,
          locale,
        });
        const waCopy = whatsappResultCopy(wa, {
          sent: t("common.whatsappSent"),
          opened: t("common.whatsappOpened"),
          fail: t("common.whatsappSendFailed"),
          noPhone: t("common.whatsappNoPhone"),
        });
        const attachHint = wa.attached
          ? hi
            ? " · पैकिंग स्लिप PDF और पेमेंट QR WhatsApp पर गए"
            : " · packing slip PDF and payment QR sent on WhatsApp"
          : wa.ok
            ? hi
              ? " · ऑर्डर लिंक मैसेज में है"
              : " · order link is in the message"
            : "";
        setMsg(
          hi
            ? `पैकिंग स्लिप फाइनल · वजन, शिपिंग और बिल अपडेट · ${waCopy}${attachHint}`
            : `Packing slip finalized · weights, shipping and bill updated · ${waCopy}${attachHint}`
        );
      } catch {
        setMsg(
          hi
            ? "पैकिंग स्लिप फाइनल · वजन, शिपिंग और बिल अपडेट"
            : "Packing slip finalized · weights, shipping and bill updated"
        );
      }
      refresh();
      const updated = billed.packingSlip;
      if (updated) setSlip(structuredClone(updated));
      setCellDrafts({});
      try {
        const m = await import("@/lib/supabase/sync");
        if (m.supabaseSyncEnabled() || (await m.detectSupabaseSync())) {
          const { loadDb } = await import("@/lib/store/db");
          await m.flushPushCloudDatabase(loadDb());
        }
      } catch {
        /* local finalize still ok */
      }
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Finalize failed");
    } finally {
      setBusy(false);
    }
  };

  const onFinalize = () => {
    setConfirmFinalize(true);
  };

  const onReopen = () => {
    try {
      const o = reopenPackingSlip(order.id, session.id);
      setSlip(
        normalizePackingSlip(o, structuredClone(o.packingSlip!))
      );
      setMsg(hi ? "फिर से एडिट के लिए खोला" : "Reopened for editing");
      refresh();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Reopen failed");
    }
  };

  const onRefreshCols = () => {
    if (
      !confirm(
        hi
          ? "कॉलम ऑर्डर लाइनों से रीफ्रेश करें? मैच न होने वाले सेल मिट सकते हैं।"
          : "Refresh columns from order lines? Unmatched cells may clear."
      )
    ) {
      return;
    }
    try {
      const o = refreshPackingSlipFromOrder(order.id);
      setSlip(structuredClone(o.packingSlip!));
      setCellDrafts({});
      setMsg(hi ? "कॉलम रीफ्रेश" : "Columns refreshed");
      refresh();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Refresh failed");
    }
  };

  const setShippingManual = (manual: boolean) => {
    if (locked) return;
    setSlip((prev) => {
      if (!prev) return prev;
      if (!manual) {
        return {
          ...prev,
          shippingManual: false,
          shippingAmount: autoShipping,
        };
      }
      return {
        ...prev,
        shippingManual: true,
        shippingAmount:
          prev.shippingAmount != null ? prev.shippingAmount : autoShipping,
      };
    });
  };

  const onShippingChange = (raw: string) => {
    if (locked) return;
    setShippingDraft(raw);
    const n = Number(raw.replace(/,/g, ""));
    setSlip((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        shippingManual: true,
        shippingAmount: Number.isFinite(n) && n >= 0 ? roundMoney(n) : 0,
      };
    });
  };

  return (
    <AdminShell wide>
      <BackToBooksBar />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 print:hidden">
        <div>
          <Link
            href={`/orders/${order.id}`}
            className="text-sm text-[var(--brand)] hover:underline"
          >
            ← {order.orderNumber}
          </Link>
          <h1 className="tt-display mt-1 text-3xl text-[var(--brand-deep)]">
            {hi ? "पैकिंग स्लिप" : "Packing slip"}
          </h1>
          <p className="mt-1 max-w-xl text-xs text-[var(--ink-muted)]">
            {hi
              ? "हर पंक्ति = एक बंडल · सेल में उसी बंडल का वजन (kg) लिखें · भरे बंडलों की गिनती ऑटो"
              : "Each row = one bundle · enter that bundle’s weight (kg) in the cell · filled bundles count auto"}
          </p>
          {!locked ? (
            <p className="mt-2 text-xs">
              <Link
                href={`/orders/${order.id}`}
                className="font-semibold text-[var(--brand)] hover:underline"
              >
                {hi
                  ? "← बिल से पहले ऑर्डर एडिट करें (बंडल / आइटम)"
                  : "← Edit order before bill (bundles / items)"}
              </Link>
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2 print:hidden">
          <button
            type="button"
            className="tt-btn tt-btn-outline"
            onClick={onPrint}
          >
            {hi ? "प्रिंट" : "Print"}
          </button>
          {!locked ? (
            <>
              <button
                type="button"
                className="tt-btn tt-btn-outline"
                onClick={onRefreshCols}
              >
                {hi ? "कॉलम रीफ्रेश" : "Refresh columns"}
              </button>
              <button
                type="button"
                className="tt-btn tt-btn-outline"
                onClick={onSave}
              >
                {hi ? "ड्राफ्ट सेव" : "Save draft"}
              </button>
              <button
                type="button"
                className="tt-btn tt-btn-dark"
                disabled={busy}
                onClick={onFinalize}
              >
                {hi ? "फाइनल करें" : "Finalize"}
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                className="tt-btn tt-btn-outline"
                disabled={busy}
                onClick={() => void onDownloadPdf()}
              >
                {hi ? "स्लिप सेव / शेयर" : "Save / share slip"}
              </button>
              <button
                type="button"
                className="tt-btn tt-btn-dark"
                disabled={busy}
                onClick={() => void onWhatsAppPdf()}
              >
                {hi ? "WhatsApp स्लिप + पेमेंट" : "WhatsApp slip + pay"}
              </button>
              <button
                type="button"
                className="tt-btn tt-btn-outline"
                onClick={onReopen}
              >
                {hi ? "फिर खोलें" : "Reopen"}
              </button>
            </>
          )}
        </div>
      </div>

      {confirmFinalize && !locked ? (
        <div className="mb-4 rounded-xl border-2 border-[var(--brand-deep)] bg-white p-4 print:hidden">
          <p className="text-sm font-semibold text-[var(--brand-deep)]">
            {hi
              ? "फाइनल करें? असली वजन, शिपिंग और बिल ऑर्डर में लग जाएगा।"
              : "Finalize? Actual weights, shipping and bill will be applied to the order."}
          </p>
          {session &&
          (checkCapability(session, db, "manage_accounts") ||
            checkCapability(session, db, "view_financials")) ? (
            <label className="mt-3 flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={allowOverCredit}
                onChange={(e) => setAllowOverCredit(e.target.checked)}
              />
              {t("accounts.allowOverCreditBill")}
            </label>
          ) : null}
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              className="tt-btn tt-btn-dark min-h-11 min-w-[120px]"
              disabled={busy}
              onClick={() => void runFinalize()}
            >
              {busy
                ? hi
                  ? "सेव हो रहा…"
                  : "Saving…"
                : hi
                  ? "हाँ, फाइनल करें"
                  : "Yes, finalize"}
            </button>
            <button
              type="button"
              className="tt-btn tt-btn-outline min-h-11"
              disabled={busy}
              onClick={() => setConfirmFinalize(false)}
            >
              {hi ? "रद्द" : "Cancel"}
            </button>
          </div>
        </div>
      ) : null}

      {msg ? (
        <p className="mb-4 text-sm font-medium text-[var(--brand)] print:hidden">
          {msg}
        </p>
      ) : null}

      {preview ? (
        <div className="mb-4 grid gap-2 rounded-xl border border-[var(--line)] bg-white p-4 sm:grid-cols-2 lg:grid-cols-4 print:hidden">
          <div>
            <p className="text-[11px] uppercase text-[var(--ink-muted)]">
              {hi ? "कुल किलो" : "Total weight"}
            </p>
            <p className="text-lg font-bold tabular-nums">
              {preview.totalKg.toFixed(2)} kg
            </p>
          </div>
          <div>
            <p className="text-[11px] uppercase text-[var(--ink-muted)]">
              {hi ? "कुल बंडल" : "Total bundles"}
            </p>
            <p className="text-lg font-bold tabular-nums">
              {preview.totalBundles} {bdlWord}
            </p>
          </div>
          <div>
            <p className="text-[11px] uppercase text-[var(--ink-muted)]">
              {hi ? "कुल बिल" : "Grand bill total"}
            </p>
            <p className="text-[10px] text-[var(--ink-muted)]">
              {hi ? "आइटम + शिपिंग" : "Items + Shipping"}
            </p>
            <p className="text-lg font-bold tabular-nums text-[var(--brand-deep)]">
              {formatInr(preview.subtotal + preview.shippingAmount, locale)}
            </p>
          </div>
          <div>
            <p className="text-[11px] uppercase text-[var(--ink-muted)]">
              {hi ? "स्थिति" : "Status"}
            </p>
            <p className="text-lg font-bold capitalize">{slip.status}</p>
          </div>
        </div>
      ) : null}

      <div className="packing-slip-scroll">
      <div
        ref={sheetRef}
        className="packing-slip-sheet mx-auto max-w-5xl min-w-0 border-2 border-black bg-white p-3 text-black shadow-[var(--shadow)] sm:p-4 print:shadow-none"
      >
        <div className="flex flex-wrap items-start justify-between gap-2 border-b border-black pb-3">
          <div className="min-w-0">
            <p className="text-xl font-black tracking-tight sm:text-2xl">
              T T ENTERPRISES
            </p>
            <p className="mt-1 text-sm font-bold tracking-[0.2em]">
              PACKING SLIP
            </p>
          </div>
          <p className="shrink-0 text-sm font-semibold">ॐ गणेशाय नमः</p>
        </div>

        <div className="mt-3 grid grid-cols-1 gap-2 text-sm sm:grid-cols-3">
          <label className="flex min-w-0 items-center gap-2">
            <span className="shrink-0 font-bold">DATE</span>
            <input
              type="date"
              className="tt-input min-w-0 flex-1 py-1"
              disabled={locked}
              value={slip.date}
              onChange={(e) => setSlip({ ...slip, date: e.target.value })}
            />
          </label>
          <div className="self-center text-left text-xs text-[var(--ink-muted)] sm:text-center">
            {order.orderNumber}
          </div>
          <label className="flex min-w-0 items-center gap-2 sm:justify-end">
            <span className="shrink-0 font-bold">SLIP NO.</span>
            <input
              className="tt-input min-w-0 flex-1 py-1 text-right sm:w-28 sm:flex-none"
              disabled={locked}
              value={slip.slipNo}
              onChange={(e) => setSlip({ ...slip, slipNo: e.target.value })}
            />
          </label>
        </div>

        <div className="mt-2 space-y-1 border border-black p-2 text-sm">
          <label className="flex items-center gap-2">
            <span className="w-20 shrink-0 font-bold">PARTY</span>
            <input
              className="min-w-0 flex-1 border-0 bg-transparent outline-none"
              disabled={locked}
              value={slip.partyName}
              onChange={(e) =>
                setSlip({ ...slip, partyName: e.target.value })
              }
            />
          </label>
          <label className="flex items-center gap-2">
            <span className="w-20 shrink-0 font-bold">PHONE</span>
            <input
              className="min-w-0 flex-1 border-0 bg-transparent outline-none"
              disabled={locked}
              value={slip.partyPhone || ""}
              onChange={(e) =>
                setSlip({ ...slip, partyPhone: e.target.value })
              }
            />
          </label>
          <label className="flex items-start gap-2">
            <span className="w-20 shrink-0 pt-1 font-bold">ADDRESS</span>
            <textarea
              className="min-h-[40px] min-w-0 flex-1 resize-y border-0 bg-transparent outline-none"
              disabled={locked}
              value={slip.partyAddress || ""}
              onChange={(e) =>
                setSlip({ ...slip, partyAddress: e.target.value })
              }
            />
          </label>
          <label className="flex items-center gap-2">
            <span className="w-20 shrink-0 font-bold">ID</span>
            <input
              className="min-w-0 flex-1 border-0 bg-transparent outline-none"
              disabled={locked}
              value={slip.partyGstin || ""}
              onChange={(e) =>
                setSlip({ ...slip, partyGstin: e.target.value })
              }
            />
          </label>
        </div>

        {columnBlocks.map((block, blockIndex) => (
        <div key={blockIndex} className="packing-slip-block mt-3 overflow-x-auto">
          {columnBlocks.length > 1 ? (
            <p className="mb-1 text-[10px] font-bold tracking-wide text-black">
              {hi ? "आइटम" : "ITEMS"} {block[0].index + 1}–
              {block[block.length - 1].index + 1} / {slip.columns.length}
            </p>
          ) : null}
          <table className="packing-slip-grid w-full border-collapse text-xs">
            <thead>
              <tr>
                <th className="packing-slip-rowlabel w-10 border border-black bg-[#f3f3f3] px-1 py-1 text-center font-bold">
                  #
                </th>
                {block.map(({ col }) => {
                  const line = order?.lines?.[col.lineIndex];
                  const productName =
                    line?.productName?.[locale] ||
                    line?.productName?.en ||
                    col.label.split(" · ")[0] ||
                    col.label;
                  const size =
                    line?.size?.[locale] || line?.size?.en || "";
                  const variation =
                    line?.variationLabel?.[locale] ||
                    line?.variationLabel?.en ||
                    "";
                  const color =
                    line?.colorName?.[locale] || line?.colorName?.en || "";
                  return (
                  <th
                    key={`${col.lineIndex}-${col.label}`}
                    className="min-w-[110px] border border-black bg-[#f3f3f3] px-1.5 py-1.5 text-left align-bottom"
                  >
                    <span className="block text-[10px] font-bold leading-tight">
                      {productName}
                    </span>
                    {size ? (
                      <span className="mt-0.5 block text-[9px] font-semibold leading-tight text-black">
                        {hi ? "साइज़" : "Size"}: {size}
                      </span>
                    ) : null}
                    {variation && variation !== size ? (
                      <span className="mt-0.5 block text-[9px] font-semibold leading-tight text-black">
                        {hi ? "वेरिएशन" : "Variation"}: {variation}
                      </span>
                    ) : null}
                    {color ? (
                      <span className="mt-0.5 block text-[9px] font-semibold leading-tight text-black">
                        {hi ? "रंग" : "Color"}: {color}
                      </span>
                    ) : null}
                    <span className="mt-1 block text-[10px] font-semibold text-black">
                      {hi ? "ऑर्डर बंडल" : "Ordered bdl"}:{" "}
                      {col.orderedBundles ?? "—"}
                    </span>
                    <span className="mt-0.5 block text-[10px] font-semibold text-[var(--brand-deep)]">
                      {hi ? "रेट" : "Rate"}: {columnRateLabel(col, locale)}
                    </span>
                  </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: rowCount }, (_, r) => (
                <tr key={r}>
                  <td className="packing-slip-rowlabel border border-black bg-[#fafafa] px-1 py-0.5 text-center text-[11px] font-bold tabular-nums">
                    {r + 1}
                  </td>
                  {block.map(({ col, index: c }) => {
                    const active =
                      r < (col.orderedBundles ?? rowCount);
                    return (
                      <td
                        key={c}
                        className={`border border-black p-0 ${
                          active ? "" : "bg-[#fafafa]"
                        }`}
                      >
                        <div className="flex items-center gap-0.5 px-1">
                          <input
                            data-slip-cell={`${r}-${c}`}
                            inputMode="decimal"
                            disabled={locked || !active}
                            placeholder={active ? "0.00" : ""}
                            title={
                              active
                                ? hi
                                  ? `बंडल ${r + 1} का वजन (kg)`
                                  : `Bundle ${r + 1} weight (kg)`
                                : undefined
                            }
                            className="min-w-0 flex-1 border-0 bg-transparent py-1 text-center tabular-nums outline-none focus:bg-amber-50 disabled:opacity-40"
                            value={cellDisplay(r, c)}
                            onChange={(e) => setCell(r, c, e.target.value)}
                            onKeyDown={(e) => onCellKeyDown(e, r, c)}
                            onFocus={(e) => {
                              try {
                                e.target.select();
                              } catch {
                                /* ignore */
                              }
                            }}
                            onBlur={() => {
                              setCellDrafts((d) => {
                                const next = { ...d };
                                delete next[cellKey(r, c)];
                                return next;
                              });
                            }}
                          />
                          {cellDisplay(r, c) !== "" ? (
                            <span className="shrink-0 text-[9px] font-semibold text-[var(--ink-muted)]">
                              kg
                            </span>
                          ) : null}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
              <tr>
                <td className="packing-slip-rowlabel border border-black bg-[#eee] px-1 py-1 text-center text-[10px] font-bold leading-tight">
                  {hi ? "कुल वजन" : "TOTAL kg"}
                </td>
                {block.map(({ index: c }) => {
                  const kg = kgTotals[c] ?? 0;
                  return (
                    <td
                      key={c}
                      className="border border-black bg-[#eee] px-1 py-1 text-center font-bold tabular-nums"
                    >
                      {kg > 0 ? `${kg.toFixed(2)} kg` : "—"}
                    </td>
                  );
                })}
              </tr>
              <tr>
                <td className="packing-slip-rowlabel border border-black bg-[#e8eef8] px-1 py-1 text-center text-[10px] font-bold leading-tight">
                  {hi ? "कुल बंडल" : "TOTAL BDL"}
                </td>
                {block.map(({ index: c }) => {
                  const b = bundleTotals[c] ?? 0;
                  return (
                    <td
                      key={c}
                      className="border border-black bg-[#e8eef8] px-1 py-1 text-center font-bold tabular-nums"
                      title={
                        hi
                          ? "जिन बंडलों में वजन भरा है, उनकी गिनती"
                          : "Count of bundles with weight entered"
                      }
                    >
                      {b > 0 ? `${b} ${bdlWord}` : "—"}
                    </td>
                  );
                })}
              </tr>
              {preview ? (
                <tr>
                  <td className="packing-slip-rowlabel border border-black bg-[#eef6ee] px-1 py-1 text-center font-bold">
                    AMOUNT
                  </td>
                  {block.map(({ index: c }) => {
                    const amt = preview.lineAmounts[c] ?? 0;
                    return (
                      <td
                        key={c}
                        className="border border-black bg-[#eef6ee] px-1 py-1 text-center font-bold tabular-nums"
                      >
                        {amt > 0 ? formatInr(amt, locale) : "—"}
                      </td>
                    );
                  })}
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        ))}

        <div className="packing-slip-keep mt-3 grid grid-cols-2 gap-2 text-sm">
          <div className="flex items-center justify-between border-2 border-black px-3 py-2 font-bold">
            <span>{hi ? "कुल वजन" : "TOTAL WEIGHT"}</span>
            <span className="tabular-nums text-base">
              {totalKg.toFixed(2)} kg
            </span>
          </div>
          <div className="flex items-center justify-between border-2 border-black px-3 py-2 font-bold">
            <span>{hi ? "कुल बंडल" : "TOTAL BUNDLES"}</span>
            <span className="tabular-nums text-base">
              {totalBundles} {bdlWord}
            </span>
          </div>
        </div>

        {/* Amount calculation — included in print/PDF (same as form) */}
        {preview ? (
          <div className="packing-slip-keep mt-3 border-2 border-black p-2 text-sm">
            <p className="border-b border-black pb-1 text-center text-xs font-black tracking-wide">
              {hi ? "राशि गणना सारांश" : "AMOUNT CALCULATION SUMMARY"}
            </p>
            <div className="mt-2 overflow-x-auto">
              <table className="w-full border-collapse text-[11px]">
                <thead>
                  <tr className="bg-[#f3f3f3]">
                    <th className="border border-black px-1 py-1 text-left">
                      {hi ? "आइटम" : "Item"}
                    </th>
                    <th className="border border-black px-1 py-1 text-right">
                      {hi ? "वजन" : "Weight"}
                    </th>
                    <th className="border border-black px-1 py-1 text-right">
                      {hi ? "कुल बंडल" : "Total bdl"}
                    </th>
                    <th className="border border-black px-1 py-1 text-right">
                      {hi ? "रेट" : "Rate"}
                    </th>
                    <th className="border border-black px-1 py-1 text-left">
                      {hi ? "गणना" : "Calc"}
                    </th>
                    <th className="border border-black px-1 py-1 text-right">
                      {hi ? "राशि" : "Amount"}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {slip.columns.map((col, i) => {
                    const kg = kgTotals[i] || 0;
                    const bdl = bundleTotals[i] || 0;
                    const amt = preview.lineAmounts[i] || 0;
                    const line = order?.lines?.[col.lineIndex];
                    const productName =
                      line?.productName?.[locale] ||
                      line?.productName?.en ||
                      col.label.split(" · ")[0] ||
                      col.label;
                    const size =
                      line?.size?.[locale] || line?.size?.en || "";
                    const variation =
                      line?.variationLabel?.[locale] ||
                      line?.variationLabel?.en ||
                      "";
                    const color =
                      line?.colorName?.[locale] || line?.colorName?.en || "";
                    const itemBits = [productName, size];
                    if (variation && variation !== size) itemBits.push(variation);
                    if (color) itemBits.push(color);
                    const itemLabel = itemBits.filter(Boolean).join(" · ");
                    const calc =
                      col.pricingMode === "pcs"
                        ? `${columnRateLabel(col, locale)} × ${bdl || col.orderedBundles || 0}`
                        : `${kg.toFixed(2)} kg × ${columnRateLabel(col, locale)}`;
                    return (
                      <tr key={i}>
                        <td className="border border-black px-1 py-1 font-semibold">
                          {itemLabel}
                        </td>
                        <td className="border border-black px-1 py-1 text-right tabular-nums">
                          {kg > 0 ? `${kg.toFixed(2)} kg` : "—"}
                        </td>
                        <td className="border border-black bg-[#e8eef8] px-1 py-1 text-right font-bold tabular-nums">
                          {bdl > 0 ? `${bdl} ${bdlWord}` : "—"}
                        </td>
                        <td className="border border-black px-1 py-1 text-right tabular-nums">
                          {columnRateLabel(col, locale)}
                        </td>
                        <td className="border border-black px-1 py-1 text-[10px] text-[var(--ink-muted)]">
                          {kg > 0 || bdl > 0 ? calc : "—"}
                        </td>
                        <td className="border border-black px-1 py-1 text-right font-bold tabular-nums">
                          {amt > 0 ? formatInr(amt, locale) : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="mt-2 space-y-1.5 border-t border-black pt-2 text-xs">
              <div className="flex justify-between">
                <span>{hi ? "कुल वजन" : "Total weight"}</span>
                <span className="tabular-nums font-semibold">
                  {totalKg.toFixed(2)} kg
                </span>
              </div>
              <div className="flex justify-between">
                <span>{hi ? "कुल बंडल" : "Total bundles"}</span>
                <span className="tabular-nums font-semibold">
                  {preview.totalBundles} {bdlWord}
                </span>
              </div>
              <div className="mt-1 border-t border-dashed border-black/40 pt-1.5">
                <p className="mb-1 text-[10px] font-black uppercase tracking-wide text-[var(--ink-muted)]">
                  {hi ? "कुल बिल गणना" : "Grand bill calculation"}
                </p>
                <div className="flex justify-between">
                  <span>{hi ? "आइटम राशि" : "Items amount"}</span>
                  <span className="tabular-nums">
                    {formatInr(preview.subtotal, locale)}
                  </span>
                </div>
                <div className="print:hidden py-2">
                  <StaffBillDiscountFields
                    goodsSubtotal={preview.subtotal}
                    schemeAmount={preview.schemeAuto}
                    schemeLabel={
                      preview.schemeBest
                        ? orderDiscountReceiptLabel(preview.schemeBest, locale)
                        : ""
                    }
                    kind={discKind}
                    value={discValue}
                    onKindChange={setDiscKind}
                    onValueChange={setDiscValue}
                    locale={locale}
                    disabled={locked}
                  />
                </div>
                <div className="flex justify-between">
                  <span>
                    {preview.weighed
                      ? hi
                        ? "− छूट"
                        : "− Discount"
                      : hi
                        ? "− छूट (तौल के बाद)"
                        : "− Discount after weighment"}
                    {preview.weighed && preview.discountMath ? (
                      <span className="mt-0.5 block text-[10px] font-semibold text-[var(--ink-muted)]">
                        {preview.discountMath}
                      </span>
                    ) : null}
                    {preview.weighed &&
                    preview.schemeBest?.scheme.name &&
                    preview.schemeDiscount > 0 ? (
                      <span className="block text-[10px] font-normal text-[var(--ink-muted)]">
                        {preview.schemeBest.scheme.name[locale] ||
                          preview.schemeBest.scheme.name.en}
                      </span>
                    ) : null}
                  </span>
                  <span className="tabular-nums">
                    {formatInr(preview.schemeDiscount, locale)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>
                    {hi ? "+ शिपिंग" : "+ Shipping"}
                    {slip.shippingManual
                      ? hi
                        ? " (मैनुअल)"
                        : " (manual)"
                      : hi
                        ? " (ऑटो)"
                        : " (auto)"}
                  </span>
                  <span className="tabular-nums">
                    {formatInr(preview.shippingAmount, locale)}
                  </span>
                </div>
                {preview.walletUsed > 0 ? (
                  <div className="flex justify-between">
                    <span>{hi ? "− वॉलेट" : "− Wallet"}</span>
                    <span className="tabular-nums">
                      {formatInr(preview.walletUsed, locale)}
                    </span>
                  </div>
                ) : null}
                <div className="mt-1 flex justify-between border-t-2 border-black pt-1.5 text-sm font-black text-[var(--brand-deep)]">
                  <span>
                    {hi ? "कुल बिल राशि" : "GRAND BILL TOTAL"}
                    <span className="mt-0.5 block text-[9px] font-semibold text-[var(--ink-muted)]">
                      {preview.walletUsed > 0 || preview.schemeDiscount > 0
                        ? hi
                          ? "आइटम + शिपिंग − छूट − वॉलेट"
                          : "Items + Shipping − Discount − Wallet"
                        : hi
                          ? "आइटम + शिपिंग"
                          : "Items + Shipping"}
                    </span>
                  </span>
                  <span className="tabular-nums text-base">
                    {formatInr(
                      preview.walletUsed > 0 || preview.schemeDiscount > 0
                        ? preview.billAmount
                        : preview.subtotal + preview.shippingAmount,
                      locale
                    )}
                  </span>
                </div>
              </div>
            </div>
          </div>
        ) : null}

        <div className="packing-slip-keep mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 border border-black px-2 py-1 text-xs print:hidden">
          <span className="font-bold">
            {hi ? "शिपिंग" : "SHIP"}
            {!slip.shippingManual ? (
              <span className="ml-1 font-normal text-[var(--ink-muted)]">
                {hi ? "ऑटो" : "auto"} · {totalKg.toFixed(1)} kg
              </span>
            ) : (
              <span className="ml-1 font-normal text-amber-700">
                {hi ? "मैनुअल" : "manual"}
              </span>
            )}
          </span>
          <span className="flex items-center gap-1">
            <span className="text-[var(--ink-muted)]">₹</span>
            <NumberField
              min={0}
              step="1"
              emptyAs={null}
              disabled={locked || !slip.shippingManual}
              className="w-20 border-0 border-b border-black bg-transparent py-0.5 text-right tabular-nums outline-none disabled:opacity-70"
              value={shippingDraft}
              onValueChange={(v) =>
                onShippingChange(v === "" ? "" : String(v))
              }
            />
          </span>
          <label className="flex items-center gap-1 font-semibold print:hidden">
            <input
              type="checkbox"
              className="scale-90"
              disabled={locked}
              checked={!!slip.shippingManual}
              onChange={(e) => setShippingManual(e.target.checked)}
            />
            {hi ? "ओवरराइड" : "Override"}
          </label>
          {slip.shippingManual ? (
            <button
              type="button"
              disabled={locked}
              className="text-[10px] font-semibold underline print:hidden"
              onClick={() => setShippingManual(false)}
            >
              {hi ? "ऑटो" : "Auto"}
            </button>
          ) : null}
          {order.shippingAmount != null &&
          order.shippingAmount !== effectiveShipping ? (
            <span className="text-[10px] text-[var(--ink-muted)] print:hidden">
              {hi ? "अनुमान:" : "Est:"}{" "}
              {formatInr(order.shippingAmount, locale)}
            </span>
          ) : null}
        </div>

        <label className="packing-slip-keep mt-2 flex min-w-0 flex-col gap-1 border border-black px-2 py-1.5 text-sm sm:flex-row sm:items-center sm:gap-2">
          <span className="shrink-0 font-bold sm:whitespace-nowrap">
            TRANSPORT/VEHICLE NO
          </span>
          <TransportInput
            className="min-w-0 flex-1 border-0 bg-transparent outline-none"
            disabled={locked}
            value={slip.transport || ""}
            onChange={(transport) => setSlip({ ...slip, transport })}
          />
        </label>

        <div className="packing-slip-keep mt-2 grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
          <label className="flex min-w-0 flex-col gap-1 border border-black px-2 py-1.5 sm:flex-row sm:items-center sm:gap-2">
            <span className="shrink-0 font-bold sm:whitespace-nowrap">
              PREPARED BY
            </span>
            <input
              className="min-w-0 flex-1 border-0 bg-transparent outline-none"
              disabled={locked}
              value={slip.preparedBy || ""}
              onChange={(e) =>
                setSlip({ ...slip, preparedBy: e.target.value })
              }
            />
          </label>
          <label className="flex min-w-0 flex-col gap-1 border border-black px-2 py-1.5 sm:flex-row sm:items-center sm:gap-2">
            <span className="shrink-0 font-bold sm:whitespace-nowrap">
              CHECKED BY
            </span>
            <input
              className="min-w-0 flex-1 border-0 bg-transparent outline-none"
              disabled={locked}
              value={slip.checkedBy || ""}
              onChange={(e) =>
                setSlip({ ...slip, checkedBy: e.target.value })
              }
            />
          </label>
        </div>

        <label className="packing-slip-keep mt-2 flex items-start gap-2 border border-black px-2 py-1.5 text-sm">
          <span className="pt-1 font-bold">NOTE</span>
          <textarea
            className="min-h-[48px] min-w-0 flex-1 resize-y border-0 bg-transparent outline-none"
            disabled={locked}
            value={slip.note || ""}
            onChange={(e) => setSlip({ ...slip, note: e.target.value })}
          />
        </label>

      </div>
      </div>
    </AdminShell>
  );
}
