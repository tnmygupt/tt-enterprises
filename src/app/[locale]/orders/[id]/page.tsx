"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { TransportInput } from "@/components/TransportInput";
import { useLocale, useTranslations } from "next-intl";
import { useParams } from "next/navigation";
import { Link, useRouter } from "@/i18n/routing";
import { NumberField } from "@/components/NumberField";
import { FilePick } from "@/components/FilePick";
import { PaymentInstructions } from "@/components/PaymentInstructions";
import { fileToDataUrl, useDb, useSession } from "@/lib/hooks";
import { calcLineTotal, computeBillFromActualWeights, formatInr } from "@/lib/pricing";
import { nextPayRefFromItems } from "@/lib/pay-ref";
import { getProofItems, proofPaidTotal, proofRemaining } from "@/lib/proofs";
import { uploadMediaFile } from "@/lib/upload-media";
import {
  addPaymentProofFiles,
  canCancelOrderStatus,
  canEditOrderBeforeBill,
  cancelOrder,
  editOrderBeforeBill,
  ensurePackingSlip,
  checkCapability,
  markOrderDispatched,
  orderHasLr,
  removePaymentProofItem,
  repairOrderShippingFromSlip,
  getCart,
  saveCart,
  updateOrderStatus,
  uploadBill,
  uploadLr,
  verifyPayment,
} from "@/lib/store/db";
import {
  dealerHasScheme,
  isSchemeVisibleToDealer,
  orderDiscountLabelForOrder,
  progressForScheme,
  schemeUnitLabel,
} from "@/lib/schemes";
import { paymentAmountDue } from "@/lib/upi";
import type { OrderStatus, PaymentProofItem } from "@/lib/types";
import { notifyLrWhatsApp, notifyOrderWhatsApp, notifyStaffPaymentProof, whatsappResultCopy } from "@/lib/whatsapp";
import { computeBillFromSlip } from "@/lib/packing-slip";
import { companyFromSettings } from "@/lib/export-pdf";
import { loadPackingSlipPdf } from "@/lib/packing-slip-pdf-lazy";
import { OrderStageTracker } from "@/components/OrderStageTracker";
import {
  ORDER_AGAIN_HINT_KEY,
  mergeOrderLinesIntoCart,
  orderAgainHint,
} from "@/lib/order-again";
import {
  allowedNextOrderStatuses,
  timelineStatusLabel,
} from "@/lib/order-stages";

function roundLineWeightTotal(weights: string[]): number {
  const sum = weights.reduce((s, w) => {
    const n = Number(w);
    return s + (Number.isFinite(n) && n > 0 ? n : 0);
  }, 0);
  return Math.round(sum * 100) / 100;
}

export default function OrderDetailPage() {
  const t = useTranslations();
  const locale = useLocale() as "en" | "hi";
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const { session } = useSession();
  const { db, refresh } = useDb();
  const order = db?.orders.find((o) => o.id === params.id);
  const [waitTicks, setWaitTicks] = useState(0);

  // Fresh place-order navigations can land before the db store notifies —
  // soft-retry without nulling the snapshot (avoids loading flash / "reload").
  useEffect(() => {
    if (order) {
      // Order arrived — stop the retry countdown
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setWaitTicks(0);
      return;
    }
    if (waitTicks >= 8) return;
    const t = window.setTimeout(() => {
      refresh();
      setWaitTicks((n) => n + 1);
    }, 350);
    return () => window.clearTimeout(t);
  }, [order, refresh, params.id, waitTicks]);

  // Sync order.shipping from packing slip when it was zeroed by sync/reprice
  useEffect(() => {
    if (!params.id || !order) return;
    const fixed = repairOrderShippingFromSlip(params.id);
    if (fixed) refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per order id
  }, [params.id, order?.id]);

  const [lineWeights, setLineWeights] = useState<string[]>([]);
  const [billFile, setBillFile] = useState<File | null>(null);
  const [proofNote, setProofNote] = useState("");
  const [proofFiles, setProofFiles] = useState<File[]>([]);
  const [proofAmount, setProofAmount] = useState("");
  const [proofBusy, setProofBusy] = useState(false);
  const [lrNumber, setLrNumber] = useState("");
  const [lrFile, setLrFile] = useState<File | null>(null);
  const [msg, setMsg] = useState("");
  const [cancelNote, setCancelNote] = useState("");
  const [editingOrder, setEditingOrder] = useState(false);
  const [editQtys, setEditQtys] = useState<string[]>([]);
  const [editRates, setEditRates] = useState<string[]>([]);
  const [editName, setEditName] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [editAddress, setEditAddress] = useState("");
  const [editGst, setEditGst] = useState("");
  const [editTransport, setEditTransport] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [editBusy, setEditBusy] = useState(false);
  const [addProductId, setAddProductId] = useState("");
  const [addVariationId, setAddVariationId] = useState("");
  const [addColorId, setAddColorId] = useState("");
  const [addQty, setAddQty] = useState("1");
  /** Local draft lines while editing (supports add/remove before save). */
  const [editLines, setEditLines] = useState<
    {
      productId: string;
      variationId?: string;
      colorId?: string;
      label: string;
      quantity: number;
      rate: number;
    }[]
  >([]);

  useEffect(() => {
    // Hydrate LR input from persisted order — intentional
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (order?.lrNumber) setLrNumber(order.lrNumber);
  }, [order?.id, order?.lrNumber]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const jumpPay =
      window.location.hash === "#pay" ||
      new URLSearchParams(window.location.search).get("pay") === "1";
    if (!jumpPay) return;
    const go = () =>
      document.getElementById("pay-now")?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    go();
    const t = window.setTimeout(go, 400);
    return () => window.clearTimeout(t);
  }, [order?.id, order?.status]);

  useEffect(() => {
    if (!order) return;
    // Refresh inputs when order identity / saved weights change
    /* eslint-disable react-hooks/set-state-in-effect */
    setLineWeights(
      order.lines.map((l) =>
        String(l.actualWeightKg ?? l.weightKg ?? l.estimatedWeightKg ?? "")
      )
    );
    /* eslint-enable react-hooks/set-state-in-effect */
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional sync from persisted order
  }, [order?.id, order?.actualWeightKg, order?.updatedAt]);

  const startEditOrder = () => {
    if (!order) return;
    setEditLines(
      order.lines.map((l) => ({
        productId: l.productId,
        variationId: l.variationId,
        colorId: l.colorId,
        label: [
          l.productName[locale] || l.productName.en,
          l.size?.[locale] || l.size?.en,
          l.colorName?.[locale] || l.colorName?.en,
        ]
          .filter(Boolean)
          .join(" · "),
        quantity: l.quantity,
        rate: l.rate,
      }))
    );
    setEditQtys(order.lines.map((l) => String(l.quantity)));
    setEditRates(order.lines.map((l) => String(l.rate)));
    setEditName(order.checkoutName || order.userName || "");
    setEditPhone(order.phone || "");
    setEditAddress(order.deliveryAddress || "");
    setEditGst(order.gstOrAadhar || "");
    setEditTransport(order.transport || "");
    setEditNotes(order.customerNotes || "");
    setAddProductId("");
    setAddVariationId("");
    setAddColorId("");
    setAddQty("1");
    setEditingOrder(true);
  };

  const onSaveOrderEdit = () => {
    if (!session || !order) return;
    setEditBusy(true);
    try {
      const lines = editLines.map((l, i) => ({
        productId: l.productId,
        variationId: l.variationId,
        colorId: l.colorId,
        quantity: Math.max(1, Math.round(Number(editQtys[i]) || l.quantity)),
        rate: Number(editRates[i]),
      }));
      if (!lines.length) {
        setMsg(
          locale === "hi"
            ? "कम से कम एक आइटम रखें"
            : "Keep at least one item"
        );
        setEditBusy(false);
        return;
      }
      editOrderBeforeBill(order.id, session.id, {
        lines,
        checkoutName: editName,
        phone: editPhone,
        deliveryAddress: editAddress,
        gstOrAadhar: editGst,
        transport: editTransport,
        customerNotes: editNotes,
      });
      setEditingOrder(false);
      setMsg(
        locale === "hi"
          ? "ऑर्डर अपडेट · पैकिंग स्लिप रीफ्रेश"
          : "Order updated · packing slip refreshed"
      );
      refresh();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Edit failed");
    } finally {
      setEditBusy(false);
    }
  };

  // Must stay above the early returns below — hooks cannot run conditionally.
  const liveBill = useMemo(() => {
    if (!order) return null;
    const weights = lineWeights.map((w) => Number(w));
    if (
      weights.length !== order.lines.length ||
      weights.some((w) => !(w > 0))
    ) {
      return null;
    }
    return computeBillFromActualWeights(order, weights);
  }, [order, lineWeights]);

  if (!db) {
    return (
      <section className="tt-section">
        <div className="tt-wrap">{t("common.loading")}</div>
      </section>
    );
  }

  if (!order) {
    return (
      <section className="tt-section">
        <div className="tt-wrap space-y-3">
          <p className="text-[var(--ink-muted)]">
            {waitTicks < 8
              ? t("common.loading")
              : locale === "hi"
                ? "ऑर्डर नहीं मिला — सिंक हो रहा हो सकता है। ऑर्डर्स सूची से खोलें।"
                : "Order not found — it may still be syncing. Open it from Orders."}
          </p>
          {waitTicks >= 8 ? (
            <Link href="/orders" className="tt-btn tt-btn-outline">
              {t("nav.orders")}
            </Link>
          ) : null}
        </div>
      </section>
    );
  }

  const isOwner = session?.id === order.userId;
  const canManage = session && checkCapability(session, db, "manage_orders");
  const canBill = session && checkCapability(session, db, "upload_bill");
  const canVerify = session && checkCapability(session, db, "verify_payment");
  const canLr =
    session &&
    (checkCapability(session, db, "upload_lr") ||
      checkCapability(session, db, "manage_orders"));
  const discountLabel = orderDiscountLabelForOrder(
    order,
    db?.schemes ?? [],
    db?.products ?? [],
    locale
  );

  // Access control: only the owner (dealer) or staff with manage caps may view.
  if (!isOwner && !canManage) {
    return (
      <section className="tt-section">
        <div className="tt-wrap">
          <p className="text-[var(--ink-muted)]">
            {locale === "hi"
              ? "यह ऑर्डर आपके अकाउंट का नहीं है।"
              : "This order is not visible on your account."}
          </p>
          <Link href="/orders" className="tt-btn tt-btn-outline mt-3">
            {t("nav.orders")}
          </Link>
        </div>
      </section>
    );
  }

  // Customers cannot cancel — admin/staff only
  const showCancel =
    Boolean(canManage) && canCancelOrderStatus(order.status);

  const sendLrToDealer = (
    saved: typeof order,
    lrFileDataUrl?: string
  ) => {
    if (db.settings.whatsappNotifyEnabled === false) {
      setMsg(
        locale === "hi" ? "LR अपलोड · डिलीवर मार्क" : "LR uploaded · marked delivered"
      );
      return;
    }
    void notifyLrWhatsApp({
      order: saved,
      settings: db.settings,
      users: db.users,
      locale,
      lrFileUrl: lrFileDataUrl || saved.lrFileDataUrl,
    }).then((result) => {
      const base = locale === "hi" ? "LR अपलोड · डिलीवर मार्क" : "LR uploaded · marked delivered";
      const wa = whatsappResultCopy(result, {
        sent: t("common.whatsappSent"),
        opened: t("common.whatsappOpened"),
        fail: t("common.whatsappSendFailed"),
        noPhone: t("common.whatsappNoPhone"),
      });
      setMsg(`${base} · ${wa}`);
    });
  };

  const tryNotify = (
    status: OrderStatus,
    patch?: Partial<typeof order>,
    extraNote?: string
  ) => {
    if (status !== "payment_verified" && !canManage) return;
    const updated = { ...order, ...patch, status };
    void notifyOrderWhatsApp({
      order: updated,
      status,
      settings: db.settings,
      users: db.users,
      locale,
      extraNote,
    }).then((result) => {
      if (db.settings.whatsappNotifyEnabled === false) return;
      setMsg(
        whatsappResultCopy(result, {
          sent: t("common.whatsappSent"),
          opened: t("common.whatsappOpened"),
          fail: t("common.whatsappSendFailed"),
          noPhone: t("common.whatsappNoPhone"),
        })
      );
    });
  };

  const onOrderAgain = () => {
    if (!isOwner || !order.lines.length) return;
    const { cart, addedLines, skippedLines } = mergeOrderLinesIntoCart(
      order.lines,
      db.products ?? [],
      getCart()
    );
    const hint = orderAgainHint({ addedLines, skippedLines, locale });
    setMsg(hint);
    if (addedLines <= 0) return;
    saveCart(cart);
    try {
      sessionStorage.setItem(ORDER_AGAIN_HINT_KEY, hint);
    } catch {
      /* private mode */
    }
    router.push("/quick-order");
  };

  const onCancelOrder = () => {
    if (!session || !canManage) return;
    if (!confirm(t("common.cancelOrderConfirm"))) return;
    try {
      cancelOrder(
        order.id,
        session.id,
        cancelNote.trim() || "Cancelled by admin"
      );
      setMsg(locale === "hi" ? "ऑर्डर रद्द हो गया" : "Order cancelled");
      refresh();
      tryNotify("cancelled");
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Cannot cancel");
    }
  };

  const onProof = async (e: FormEvent) => {
    e.preventDefault();
    if (!session) return;
    if (!proofFiles.length) {
      setMsg(
        locale === "hi"
          ? "कम से कम एक फ़ाइल चुनें"
          : "Choose at least one file"
      );
      return;
    }
    const parsedAmount = Number(proofAmount);
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      setMsg(
        locale === "hi"
          ? "इस पेमेंट की रकम ₹ डालें (पार्ट पेमेंट के लिए ज़रूरी)"
          : "Enter the amount paid ₹ for this upload (required for part-payments)"
      );
      return;
    }
    const amountDue = paymentAmountDue(order);
    const remaining = proofRemaining(order.paymentProof, amountDue);
    if (remaining <= 0) {
      setMsg(
        locale === "hi"
          ? "बाकी शून्य है — और पेमेंट की जरूरत नहीं"
          : "Nothing left to pay on this order"
      );
      return;
    }
    if (parsedAmount > remaining + 0.009) {
      setMsg(
        locale === "hi"
          ? `रकम बाकी से ज़्यादा नहीं हो सकती (${formatInr(remaining, locale)})`
          : `Amount cannot exceed remaining balance (${formatInr(remaining, locale)})`
      );
      setProofAmount(String(remaining));
      return;
    }
    setProofBusy(true);
    setMsg("");
    try {
      // Cap to remaining so totals stay sensible; allow tiny overpay rounding.
      const capped = Math.min(
        parsedAmount,
        Math.round(remaining * 100) / 100
      );
      const perFile =
        Math.round((capped / proofFiles.length) * 100) / 100;
      const items: PaymentProofItem[] = [];
      const errors: string[] = [];
      for (const file of proofFiles) {
        try {
          const up = await uploadMediaFile(file, "proofs");
          if (up.type === "video") {
            throw new Error("Videos not allowed for payment proof");
          }
          if (!up.url || up.url.startsWith("data:")) {
            throw new Error(
              locale === "hi"
                ? "सर्वर पर अपलोड नहीं हुआ — दोबारा कोशिश करें या छोटी JPG/PNG चुनें"
                : "Upload to server failed — retry or pick a smaller JPG/PNG"
            );
          }
          items.push({
            id: `pp_${crypto.randomUUID()}`,
            url: up.url,
            type: up.type === "pdf" ? "pdf" : "image",
            fileName: file.name,
            note: proofNote.trim() || undefined,
            payRef: nextPayRefFromItems(
              order.orderNumber,
              getProofItems(order.paymentProof)
            ),
            amount: perFile,
            uploadedAt: new Date().toISOString(),
            uploadedBy: session.id,
          });
        } catch (err) {
          errors.push(
            `${file.name}: ${err instanceof Error ? err.message : "upload failed"}`
          );
        }
      }
      if (items.length) {
        addPaymentProofFiles(order.id, items, session.id);
        setProofFiles([]);
        setProofNote("");
        setProofAmount("");
        const uploadedAmt = items.reduce((s, it) => s + (it.amount || 0), 0);
        const nextPaid =
          proofPaidTotal(order.paymentProof) + uploadedAmt;
        const nextRemain = Math.max(0, Math.round((amountDue - nextPaid) * 100) / 100);
        setMsg(
          locale === "hi"
            ? `${items.length} फ़ाइल अपलोड · भुगतान ${formatInr(nextPaid, locale)}${
                nextRemain > 0 ? ` · बाकी ${formatInr(nextRemain, locale)}` : " · पूरा"
              }`
            : `${items.length} file${items.length === 1 ? "" : "s"} uploaded · paid ${formatInr(nextPaid, locale)}${
                nextRemain > 0 ? ` · remaining ${formatInr(nextRemain, locale)}` : " · fully paid"
              }`
        );
        if (db.settings.whatsappNotifyEnabled !== false) {
          void notifyStaffPaymentProof({
            order,
            settings: db.settings,
            users: db.users,
            locale,
            amount: uploadedAmt || nextPaid || amountDue,
            payRef: items[0]?.payRef,
            remaining: nextRemain,
            skipUserIds: [session.id],
          });
        }
        refresh();
      } else if (errors.length) {
        setMsg(errors.join(" · "));
      }
      if (items.length && errors.length) {
        setMsg(
          (locale === "hi" ? "कुछ फ़ाइलें फेल: " : "Some files failed: ") +
            errors.join(" · ")
        );
      }
    } finally {
      setProofBusy(false);
    }
  };

  const parsedLineWeights = () => lineWeights.map((w) => Number(w));

  /** One save: final kg → schemes + actual bill (₹ from rate × kg). */
  const onSaveFinalKgBill = async (e: FormEvent) => {
    e.preventDefault();
    if (!canBill && !canManage) return;
    if (order.packingSlip?.status === "finalized") {
      setMsg(
        locale === "hi"
          ? "पैकिंग स्लिप फाइनल है — असली kg/बिल बदलने के लिए स्लिप फिर खोलें"
          : "Packing slip is finalized — reopen the packing slip to change final kg / bill"
      );
      return;
    }
    try {
      const billFileDataUrl = billFile
        ? await fileToDataUrl(billFile)
        : undefined;
      const weights = parsedLineWeights();
      if (
        weights.length !== order.lines.length ||
        weights.some((w) => !(w > 0))
      ) {
        setMsg(
          locale === "hi"
            ? "हर आइटम का असली वजन (kg) डालें"
            : "Enter actual weight (kg) for every item"
        );
        return;
      }
      const preview = computeBillFromActualWeights(order, weights);
      if (!(preview.grossBill > 0)) {
        setMsg(
          locale === "hi"
            ? "किलो से बिल 0 है — वजन जाँचें"
            : "Bill from kg is ₹0 — check weights"
        );
        return;
      }
      uploadBill(
        order.id,
        preview.grossBill,
        billFileDataUrl,
        weights,
        session?.id || "system"
      );
      setMsg(
        locale === "hi"
          ? `असली kg सेव · बिल ₹${preview.grossBill} · स्कीम अपडेट`
          : `Final kg saved · bill ₹${preview.grossBill} · schemes updated`
      );
      refresh();
      tryNotify("payment_pending", {
        actualBillAmount: preview.grossBill,
      });
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Save failed");
    }
  };

  const setLineWeightAt = (index: number, value: string) => {
    setLineWeights((prev) => {
      const next = [...prev];
      next[index] = value;
      return next;
    });
  };

  const onDispatch = () => {
    if (!canManage) return;
    try {
      markOrderDispatched(order.id);
      setMsg(
        locale === "hi"
          ? "डिस्पैच हो गया — LR अपलोड बाकी"
          : "Dispatched — LR upload pending"
      );
      refresh();
      tryNotify(
        "dispatched",
        undefined,
        locale === "hi" ? "LR अपलोड बाकी" : "LR upload pending"
      );
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Cannot dispatch");
    }
  };

  const onLr = async (e: FormEvent) => {
    e.preventDefault();
    try {
      let lrFileDataUrl: string | undefined;
      if (lrFile) {
        const up = await uploadMediaFile(lrFile, "lr");
        lrFileDataUrl = up.url;
      }
      const saved = uploadLr(order.id, { lrNumber, lrFileDataUrl });
      setLrFile(null);
      sendLrToDealer(saved, lrFileDataUrl);
      refresh();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "LR upload failed");
    }
  };

  const pendingLr =
    order.status === "dispatched" && !orderHasLr(order);

  return (
    <section className="tt-section">
      <div className="tt-wrap min-w-0">
        <p className="text-sm text-[var(--ink-muted)]">
          <Link href="/orders">{t("nav.orders")}</Link>
        </p>
        <div className="mt-2 flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <h1 className="tt-display text-2xl text-[var(--brand-deep)] sm:text-4xl">
              {order.orderNumber}
            </h1>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="tt-status inline-flex text-base">
                {t(`orderStatus.${order.status}` as "orderStatus.estimate")}
              </span>
              {pendingLr && canManage ? (
                <span className="tt-chip border border-amber-600/40 bg-amber-50 font-bold text-amber-900">
                  {locale === "hi"
                    ? "LR → डिलीवर बाकी"
                    : "Pending LR → delivered"}
                </span>
              ) : null}
              {order.status === "dispatched" && orderHasLr(order) ? (
                <span className="tt-chip border border-[var(--ok)]/30 bg-[#e8f2ea] font-bold text-[var(--ok)]">
                  {locale === "hi" ? "LR अपलोड हो गया" : "LR uploaded"}
                </span>
              ) : null}
              {order.fullTruckRequested ? (
                <span className="tt-chip">
                  {locale === "hi" ? "फुल ट्रक" : "Full truck requested"}
                </span>
              ) : null}
            </div>
            <p className="mt-3 text-sm font-semibold text-[var(--ink)]">
              {order.status === "estimate"
                ? locale === "hi"
                  ? "ऑफिस को अनुमान मिल गया है। पैकिंग के बाद अंतिम बिल आएगा।"
                  : "Office has your estimate. Final bill comes after packing."
                : order.status === "confirmed"
                  ? locale === "hi"
                    ? "ऑर्डर कन्फर्म है। स्टाफ वजन और पैकिंग स्लिप बनाएगा।"
                    : "Confirmed. Staff will weigh and make the packing slip."
                  : order.status === "payment_pending"
                    ? locale === "hi"
                      ? "बिल तैयार है। नीचे QR स्कैन करें या UPI ऐप खोलें, फिर प्रूफ अपलोड करें।"
                      : "Bill is ready. Scan the QR or open the UPI app below, then upload proof."
                    : order.status === "payment_verified"
                      ? locale === "hi"
                        ? "पेमेंट मिल गया। माल डिस्पैच होगा।"
                        : "Payment received. Goods will be dispatched."
                      : order.status === "dispatched"
                        ? locale === "hi"
                          ? "माल रस्ते में है। LR कॉपी WhatsApp पर आएगी।"
                          : "On the way. LR copy will be sent on WhatsApp."
                        : order.status === "delivered"
                          ? locale === "hi"
                            ? "डिलीवर हो गया। LR इसी पेज पर है।"
                            : "Delivered. LR is on this page."
                          : locale === "hi"
                            ? "यह ऑर्डर रद्द है।"
                            : "This order was cancelled."}
            </p>
            {order.status === "payment_pending" ? (
              <a
                href="#pay-now"
                className="tt-btn tt-btn-dark mt-4 inline-flex w-full justify-center lg:hidden"
              >
                {locale === "hi" ? "पेमेंट करें" : "Pay now"}
              </a>
            ) : null}
          </div>
          {isOwner && order.lines.length ? (
            <button
              type="button"
              className="tt-btn tt-btn-outline text-sm"
              onClick={onOrderAgain}
            >
              {t("common.orderAgain")}
            </button>
          ) : null}
        </div>

        <div className="mt-5 rounded-2xl border-2 border-[var(--brand-deep)]/20 bg-white p-4 sm:p-5">
          <h2 className="text-base font-bold text-[var(--brand-deep)]">
            {locale === "hi" ? "ग्राहक जानकारी" : "Customer info"}
          </h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 text-sm">
            <div>
              <p className="text-xs font-bold uppercase tracking-wide text-[var(--ink-muted)]">
                {locale === "hi" ? "नाम" : "Name"}
              </p>
              <p className="mt-0.5 text-base font-bold break-words">
                {order.checkoutName || order.userName}
              </p>
            </div>
            <div>
              <p className="text-xs font-bold uppercase tracking-wide text-[var(--ink-muted)]">
                {locale === "hi" ? "नंबर" : "Phone"}
              </p>
              <p className="mt-0.5 text-base font-bold break-all">
                {order.phone || "—"}
              </p>
            </div>
            <div>
              <p className="text-xs font-bold uppercase tracking-wide text-[var(--ink-muted)]">
                GST / Aadhaar
              </p>
              <p className="mt-0.5 text-base font-bold break-all">
                {order.gstOrAadhar || "—"}
              </p>
            </div>
            <div>
              <p className="text-xs font-bold uppercase tracking-wide text-[var(--ink-muted)]">
                Transport
              </p>
              <p className="mt-0.5 text-base font-bold break-words">
                {order.transport || "—"}
              </p>
            </div>
            <div className="sm:col-span-2 min-w-0">
              <p className="text-xs font-bold uppercase tracking-wide text-[var(--ink-muted)]">
                {locale === "hi" ? "पता" : "Ship to"}
              </p>
              <p className="mt-0.5 text-base font-bold break-words">
                {order.deliveryAddress || "—"}
              </p>
            </div>
            {order.customerNotes ? (
              <div className="sm:col-span-2 lg:col-span-3">
                <p className="text-xs font-bold uppercase tracking-wide text-[var(--ink-muted)]">
                  {locale === "hi" ? "नोट्स" : "Notes"}
                </p>
                <p className="mt-0.5 font-semibold">{order.customerNotes}</p>
              </div>
            ) : null}
          </div>
        </div>

        {/* Packing slip */}
        <div className="mt-6 tt-panel p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold">
                {locale === "hi" ? "पैकिंग स्लिप" : "Packing slip"}
              </h2>
              <p className="mt-1 text-sm text-[var(--ink-muted)]">
                {order.packingSlip
                  ? `${order.packingSlip.slipNo} · ${order.packingSlip.status}`
                  : locale === "hi"
                    ? "अभी स्लिप नहीं — स्टाफ़ बना सकता है।"
                    : "No slip yet — staff can create one."}
              </p>
              {order.packingSlip?.status === "draft" && canManage ? (
                <p className="mt-1 text-xs text-[var(--ink-muted)]">
                  {locale === "hi" ? "लाइव अनुमान बिल: " : "Live computed bill: "}
                  {(() => {
                    const p = computeBillFromSlip(order, order.packingSlip!);
                    return formatInr(p.subtotal + p.shippingAmount, locale);
                  })()}
                </p>
              ) : null}
            </div>
            <div className="flex flex-wrap gap-2">
              {canManage ? (
                <Link
                  href={`/admin/orders/${order.id}/packing-slip`}
                  className="tt-btn tt-btn-dark"
                  onClick={() => {
                    if (!order.packingSlip) {
                      try {
                        ensurePackingSlip(order.id);
                        refresh();
                      } catch {
                        /* ignore */
                      }
                    }
                  }}
                >
                  {locale === "hi"
                    ? order.packingSlip
                      ? "स्लिप खोलें / एडिट"
                      : "स्लिप बनाएँ"
                    : order.packingSlip
                      ? "Open / edit slip"
                      : "Create slip"}
                </Link>
              ) : null}
              {order.packingSlip?.status === "finalized" ? (
                <button
                  type="button"
                  className="tt-btn tt-btn-outline"
                  // Warm the PDF chunk before the click so iOS keeps the gesture
                  onPointerDown={() => void loadPackingSlipPdf()}
                  onClick={() => {
                    void loadPackingSlipPdf()
                      .then((m) =>
                        m.downloadPackingSlipPdf(
                          order,
                          locale,
                          companyFromSettings(db?.settings)
                        )
                      )
                      .catch((err) =>
                        setMsg(err instanceof Error ? err.message : "PDF failed")
                      );
                  }}
                >
                  {locale === "hi" ? "स्लिप सेव / शेयर" : "Save / share slip"}
                </button>
              ) : null}
            </div>
          </div>
        </div>

        {canManage && canEditOrderBeforeBill(order) ? (
          <div className="mt-6 rounded-2xl border-2 border-[var(--brand-deep)]/25 bg-white p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-base font-bold text-[var(--brand-deep)]">
                  {locale === "hi"
                    ? "अंतिम बिल से पहले ऑर्डर एडिट"
                    : "Edit order before final bill"}
                </h2>
                <p className="mt-0.5 text-xs text-[var(--ink-muted)]">
                  {locale === "hi"
                    ? "बंडल / रेट / पार्टी बदलें। सेव पर स्टॉक और पैकिंग स्लिप अपडेट होंगे।"
                    : "Change bundles, rates, party. Save updates stock + packing slip."}
                </p>
              </div>
              {!editingOrder ? (
                <button
                  type="button"
                  className="tt-btn tt-btn-outline"
                  onClick={startEditOrder}
                >
                  {locale === "hi" ? "एडिट करें" : "Edit order"}
                </button>
              ) : (
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="tt-btn tt-btn-outline"
                    disabled={editBusy}
                    onClick={() => setEditingOrder(false)}
                  >
                    {locale === "hi" ? "रद्द" : "Cancel"}
                  </button>
                  <button
                    type="button"
                    className="tt-btn tt-btn-dark"
                    disabled={editBusy}
                    onClick={onSaveOrderEdit}
                  >
                    {editBusy
                      ? locale === "hi"
                        ? "सेव…"
                        : "Saving…"
                      : locale === "hi"
                        ? "सेव करें"
                        : "Save changes"}
                  </button>
                </div>
              )}
            </div>

            {editingOrder ? (
              <div className="mt-4 space-y-3">
                <div className="grid gap-2 sm:grid-cols-2">
                  <label className="block text-xs">
                    <span className="tt-label">{locale === "hi" ? "पार्टी" : "Party"}</span>
                    <input
                      className="tt-input"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                    />
                  </label>
                  <label className="block text-xs">
                    <span className="tt-label">{locale === "hi" ? "फोन" : "Phone"}</span>
                    <input
                      className="tt-input"
                      value={editPhone}
                      onChange={(e) => setEditPhone(e.target.value)}
                    />
                  </label>
                  <label className="block text-xs sm:col-span-2">
                    <span className="tt-label">
                      {locale === "hi" ? "पता" : "Address"}
                    </span>
                    <textarea
                      className="tt-input min-h-[56px]"
                      value={editAddress}
                      onChange={(e) => setEditAddress(e.target.value)}
                    />
                  </label>
                  <label className="block text-xs">
                    <span className="tt-label">GST / ID</span>
                    <input
                      className="tt-input"
                      value={editGst}
                      onChange={(e) => setEditGst(e.target.value)}
                    />
                  </label>
                  <label className="block text-xs">
                    <span className="tt-label">
                      {locale === "hi" ? "ट्रांसपोर्ट" : "Transport"}
                    </span>
                    <TransportInput
                      value={editTransport}
                      onChange={setEditTransport}
                    />
                  </label>
                  <label className="block text-xs sm:col-span-2">
                    <span className="tt-label">
                      {locale === "hi" ? "नोट्स" : "Notes"}
                    </span>
                    <input
                      className="tt-input"
                      value={editNotes}
                      onChange={(e) => setEditNotes(e.target.value)}
                    />
                  </label>
                </div>

                <div className="space-y-2">
                  {editLines.map((line, i) => (
                    <div
                      key={`${line.productId}-${line.variationId}-${i}`}
                      className="grid gap-2 rounded-lg border border-[var(--line)] bg-[var(--surface)] p-3 sm:grid-cols-[1fr_88px_100px_auto]"
                    >
                      <p className="text-sm font-semibold">{line.label}</p>
                      <label className="text-xs">
                        <span className="text-[var(--ink-muted)]">
                          {locale === "hi" ? "बंडल" : "Bundles"}
                        </span>
                        <NumberField
                          min={1}
                          integer
                          emptyAs={null}
                          className="tt-input mt-0.5"
                          value={editQtys[i] ?? ""}
                          onValueChange={(v) => {
                            setEditQtys((prev) => {
                              const next = [...prev];
                              next[i] = v === "" ? "" : String(v);
                              return next;
                            });
                          }}
                        />
                      </label>
                      <label className="text-xs">
                        <span className="text-[var(--ink-muted)]">
                          {locale === "hi" ? "रेट ₹" : "Rate ₹"}
                        </span>
                        <NumberField
                          min={0}
                          step="0.01"
                          emptyAs={null}
                          className="tt-input mt-0.5"
                          value={editRates[i] ?? ""}
                          onValueChange={(v) => {
                            setEditRates((prev) => {
                              const next = [...prev];
                              next[i] = v === "" ? "" : String(v);
                              return next;
                            });
                          }}
                        />
                      </label>
                      <button
                        type="button"
                        className="tt-btn tt-btn-outline self-end text-xs"
                        disabled={editLines.length <= 1}
                        onClick={() => {
                          setEditLines((prev) =>
                            prev.filter((_, j) => j !== i)
                          );
                          setEditQtys((prev) =>
                            prev.filter((_, j) => j !== i)
                          );
                          setEditRates((prev) =>
                            prev.filter((_, j) => j !== i)
                          );
                        }}
                      >
                        {locale === "hi" ? "हटाएँ" : "Remove"}
                      </button>
                    </div>
                  ))}
                </div>

                <div className="rounded-lg border border-dashed border-[var(--line)] p-3">
                  <p className="text-xs font-bold uppercase text-[var(--ink-muted)]">
                    {locale === "hi" ? "आइटम जोड़ें" : "Add item"}
                  </p>
                  <div className="mt-2 grid gap-2 sm:grid-cols-4">
                    <select
                      className="tt-input"
                      value={addProductId}
                      onChange={(e) => {
                        setAddProductId(e.target.value);
                        setAddVariationId("");
                        setAddColorId("");
                      }}
                    >
                      <option value="">
                        {locale === "hi" ? "प्रोडक्ट" : "Product"}
                      </option>
                      {db.products
                        .filter((p) => p.active !== false)
                        .map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name[locale] || p.name.en}
                          </option>
                        ))}
                    </select>
                    <select
                      className="tt-input"
                      value={addVariationId}
                      disabled={!addProductId}
                      onChange={(e) => setAddVariationId(e.target.value)}
                    >
                      <option value="">
                        {locale === "hi" ? "साइज़" : "Size"}
                      </option>
                      {(
                        db.products.find((p) => p.id === addProductId)
                          ?.variations || []
                      ).map((v) => (
                        <option key={v.id} value={v.id}>
                          {v.size?.[locale] ||
                            v.size?.en ||
                            v.label?.[locale] ||
                            v.label?.en ||
                            v.id}
                        </option>
                      ))}
                    </select>
                    <select
                      className="tt-input"
                      value={addColorId}
                      disabled={!addProductId}
                      onChange={(e) => setAddColorId(e.target.value)}
                    >
                      <option value="">
                        {locale === "hi" ? "रंग (वैकल्पिक)" : "Color (opt)"}
                      </option>
                      {(
                        db.products.find((p) => p.id === addProductId)
                          ?.colors || []
                      ).map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name[locale] || c.name.en}
                        </option>
                      ))}
                    </select>
                    <div className="flex gap-2">
                      <NumberField
                        min={1}
                        integer
                        emptyAs={null}
                        className="tt-input w-20"
                        value={addQty}
                        onValueChange={(v) =>
                          setAddQty(v === "" ? "" : String(v))
                        }
                        placeholder="Qty"
                      />
                      <button
                        type="button"
                        className="tt-btn tt-btn-outline flex-1"
                        onClick={() => {
                          const product = db.products.find(
                            (p) => p.id === addProductId
                          );
                          if (!product || !addVariationId) {
                            setMsg(
                              locale === "hi"
                                ? "प्रोडक्ट और साइज़ चुनें"
                                : "Pick product and size"
                            );
                            return;
                          }
                          const variation = product.variations.find(
                            (v) => v.id === addVariationId
                          );
                          const color = product.colors.find(
                            (c) => c.id === addColorId
                          );
                          const qty = Math.max(
                            1,
                            Math.round(Number(addQty) || 1)
                          );
                          const rate = variation?.rate ?? product.baseRate;
                          const label = [
                            product.name[locale] || product.name.en,
                            variation?.size?.[locale] ||
                              variation?.size?.en ||
                              variation?.label?.[locale],
                            color?.name?.[locale] || color?.name?.en,
                          ]
                            .filter(Boolean)
                            .join(" · ");
                          setEditLines((prev) => [
                            ...prev,
                            {
                              productId: product.id,
                              variationId: variation?.id,
                              colorId: color?.id,
                              label,
                              quantity: qty,
                              rate,
                            },
                          ]);
                          setEditQtys((prev) => [...prev, String(qty)]);
                          setEditRates((prev) => [...prev, String(rate)]);
                          setAddProductId("");
                          setAddVariationId("");
                          setAddColorId("");
                          setAddQty("1");
                        }}
                      >
                        {locale === "hi" ? "जोड़ें" : "Add"}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="mt-8 grid min-w-0 gap-6 lg:grid-cols-[1.2fr_0.8fr] lg:gap-10">
        <div className="order-1 min-w-0">
          {/* Lines always first — dealers should see their order before admin ops */}
          {(() => {
            const hasActuals =
              order.actualWeightKg != null ||
              order.actualBillAmount != null ||
              order.lines.some(
                (l) => l.actualWeightKg != null && l.actualWeightKg > 0
              );
            const displayShipping =
              order.packingSlip?.shippingAmount != null &&
              Number.isFinite(order.packingSlip.shippingAmount)
                ? Math.max(0, order.packingSlip.shippingAmount)
                : order.shippingAmount;
            return (
          <>
          <div className="min-w-0 space-y-3">
            {order.lines.map((l, i) => {
              const linePrice =
                hasActuals &&
                l.actualWeightKg != null &&
                l.actualWeightKg > 0
                  ? formatInr(
                      l.pricingMode === "pcs"
                        ? l.rate * l.quantity
                        : l.rate * l.actualWeightKg,
                      locale
                    )
                  : formatInr(l.lineTotal, locale);
              return (
              <article key={i} className="tt-mobile-card">
                <div className="flex min-w-0 flex-col gap-1">
                  <div className="flex min-w-0 items-start justify-between gap-3">
                    <p className="min-w-0 flex-1 font-semibold break-words">
                      {l.productName?.[locale] || l.productName?.en || "Item"}
                    </p>
                    <p className="tt-line-price shrink-0 text-right text-[var(--brand-deep)]">
                      {linePrice}
                    </p>
                  </div>
                  <p className="text-xs text-[var(--ink-muted)] break-words">
                    {l.productCode}
                    {l.size?.[locale]
                      ? ` · Size: ${l.size[locale]}`
                      : l.variationLabel?.[locale] || l.variationLabel?.en
                        ? ` · ${l.variationLabel?.[locale] || l.variationLabel?.en}`
                        : ""}
                    {l.colorName?.[locale] || l.colorName?.en
                      ? ` · ${l.colorName?.[locale] || l.colorName?.en}`
                      : ""}
                  </p>
                </div>
                <div
                  className={`mt-3 grid gap-2 text-sm ${
                    hasActuals ? "grid-cols-2" : "grid-cols-3"
                  }`}
                >
                  <div>
                    <p className="text-xs text-[var(--ink-muted)]">
                      {t("common.quantity")}
                    </p>
                    <p className="font-semibold">{l.quantity}</p>
                  </div>
                  {hasActuals ? (
                    <div>
                      <p className="text-xs text-[var(--ink-muted)]">
                        {locale === "hi" ? "वजन" : "Weight"}
                      </p>
                      <p className="font-semibold tabular-nums text-[var(--brand-deep)]">
                        {l.actualWeightKg != null
                          ? `${l.actualWeightKg} ${t("common.kg")}`
                          : "—"}
                      </p>
                    </div>
                  ) : (
                    <>
                      <div>
                        <p className="text-xs text-[var(--ink-muted)]">
                          {locale === "hi" ? "अनुमान" : "Est."}
                        </p>
                        <p className="font-semibold tabular-nums">
                          {l.estimatedWeightKg ?? l.weightKg} {t("common.kg")}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-[var(--ink-muted)]">
                          {locale === "hi" ? "असली" : "Actual"}
                        </p>
                        <p className="font-semibold tabular-nums">—</p>
                      </div>
                    </>
                  )}
                </div>
              </article>
              );
            })}
          </div>

          <div className="mt-6 space-y-2 text-sm">
            {!hasActuals ? (
              <>
                <div className="tt-kv-row">
                  <span>{t("common.subtotal")}</span>
                  <span>{formatInr(order.subtotal, locale)}</span>
                </div>
                <div className="tt-kv-row">
                  <span>{t("common.shipping")}</span>
                  <span>{formatInr(displayShipping, locale)}</span>
                </div>
                {(order.schemeDiscount ?? 0) > 0 ? (
                  <div className="tt-kv-row text-[var(--ok)]">
                    <span>
                      {t("common.schemeDiscount")}
                      {discountLabel ? ` · ${discountLabel}` : ""}
                    </span>
                    <span>-{formatInr(order.schemeDiscount || 0, locale)}</span>
                  </div>
                ) : null}
                <div className="tt-kv-row">
                  <span>{t("common.wallet")}</span>
                  <span>-{formatInr(order.walletUsed, locale)}</span>
                </div>
                <div className="tt-kv-row font-bold">
                  <span>{t("common.estimate")}</span>
                  <span>{formatInr(order.estimatedTotal, locale)}</span>
                </div>
                <div className="tt-kv-row text-[var(--ink-muted)]">
                  <span>
                    {locale === "hi" ? "अनुमान वजन" : "Estimate weight"}
                  </span>
                  <span>
                    {order.estimatedWeightKg ??
                      order.lines.reduce((s, l) => s + (l.weightKg || 0), 0)}{" "}
                    {t("common.kg")}
                  </span>
                </div>
              </>
            ) : (
              <>
                <div className="tt-kv-row">
                  <span>{t("common.shipping")}</span>
                  <span>{formatInr(displayShipping, locale)}</span>
                </div>
                {(order.schemeDiscount ?? 0) > 0 ? (
                  <div className="tt-kv-row text-[var(--ok)]">
                    <span>
                      {t("common.schemeDiscount")}
                      {discountLabel ? ` · ${discountLabel}` : ""}
                    </span>
                    <span>-{formatInr(order.schemeDiscount || 0, locale)}</span>
                  </div>
                ) : null}
                {order.walletUsed > 0 ? (
                  <div className="tt-kv-row">
                    <span>{t("common.wallet")}</span>
                    <span>-{formatInr(order.walletUsed, locale)}</span>
                  </div>
                ) : null}
                {order.actualWeightKg != null ? (
                  <div className="tt-kv-row font-bold text-[var(--brand-deep)]">
                    <span>
                      {locale === "hi" ? "असली वजन" : "Actual weight"}
                    </span>
                    <span>
                      {order.actualWeightKg} {t("common.kg")}
                    </span>
                  </div>
                ) : null}
                {order.actualBillAmount != null ? (
                  <div className="tt-kv-row font-bold text-[var(--brand-deep)] text-base">
                    <span>
                      {locale === "hi" ? "अंतिम बिल" : "Final bill"}
                    </span>
                    <span>{formatInr(order.actualBillAmount, locale)}</span>
                  </div>
                ) : null}
              </>
            )}
          </div>
          </>
            );
          })()}

          {db ? (
            <div className="mt-6 rounded-xl border border-[var(--line)] bg-[var(--surface)] p-4">
              <h3 className="text-sm font-bold text-[var(--brand-deep)]">
                {locale === "hi" ? "स्कीम प्रभाव" : "Scheme impact"}
              </h3>
              <p className="mt-1 text-xs text-[var(--ink-muted)]">
                {locale === "hi"
                  ? "केवल असली वजन। कैंसल होने पर स्कीम से हटता है।"
                  : "Actual weight only. Cancelled orders are removed from schemes."}
              </p>
              {order.status === "cancelled" ? (
                <p className="mt-3 text-sm font-semibold text-[var(--danger)]">
                  {locale === "hi"
                    ? "ऑर्डर कैंसल — स्कीम वजन हटाया गया"
                    : "Order cancelled — scheme weight removed"}
                </p>
              ) : order.lines.every((l) => l.actualWeightKg == null) ? (
                <p className="mt-3 text-sm text-[var(--ink-muted)]">
                  {locale === "hi"
                    ? "अभी अनुमान वजन है — बिल/असली वजन सेट होने पर स्कीम में जुड़ेगा।"
                    : "Still on estimate — schemes update when bill actual weight is set."}
                </p>
              ) : (
                <ul className="mt-3 space-y-2 text-sm">
                  {db.schemes
                    .filter((s) => {
                      const dealer = db.users.find((u) => u.id === order.userId);
                      return (
                        isSchemeVisibleToDealer(s) &&
                        dealerHasScheme(s, dealer?.assignedSchemeIds || []) &&
                        progressForScheme(s, order.lines, db.products) > 0
                      );
                    })
                    .map((s) => {
                      const amt = progressForScheme(
                        s,
                        order.lines,
                        db.products
                      );
                      return (
                        <li
                          key={s.id}
                          className="flex justify-between gap-3 rounded-lg bg-white px-3 py-2"
                        >
                          <span className="font-medium">{s.name[locale]}</span>
                          <span className="tabular-nums font-semibold text-[var(--brand)]">
                            +{amt.toFixed(0)} {schemeUnitLabel(s, locale)}
                          </span>
                        </li>
                      );
                    })}
                  {!db.schemes.some((s) => {
                    const dealer = db.users.find((u) => u.id === order.userId);
                    return (
                      isSchemeVisibleToDealer(s) &&
                      dealerHasScheme(s, dealer?.assignedSchemeIds || []) &&
                      progressForScheme(s, order.lines, db.products) > 0
                    );
                  }) ? (
                    <li className="text-[var(--ink-muted)]">
                      {locale === "hi"
                        ? "इस ऑर्डर से कोई स्कीम मैच नहीं।"
                        : "No matching scheme for this order."}
                    </li>
                  ) : null}
                </ul>
              )}
              <Link
                href="/schemes"
                className="mt-3 inline-block text-sm font-semibold text-[var(--brand)]"
              >
                {locale === "hi" ? "स्कीम ट्रैकिंग देखें →" : "View scheme tracking →"}
              </Link>
            </div>
          ) : null}

          <div className="mt-8 space-y-6">
            <OrderStageTracker order={order} locale={locale} />
            <div>
              <h2 className="tt-display text-xl">{t("common.track")}</h2>
              <ol className="mt-4 space-y-3 border-l-2 border-[var(--brand)] pl-4">
                {order.timeline.map((ev, i) => (
                  <li key={i}>
                    <p className="font-semibold">
                      {timelineStatusLabel(String(ev.status), locale)}
                    </p>
                    <p className="text-xs text-[var(--ink-muted)]">
                      {new Date(ev.at).toLocaleString(
                        locale === "hi" ? "hi-IN" : "en-IN"
                      )}
                      {ev.note ? ` · ${ev.note}` : ""}
                    </p>
                  </li>
                ))}
              </ol>
            </div>
          </div>

        </div>

        <aside className="order-2 min-w-0 space-y-6 lg:order-2">
          {msg ? <p className="rounded-xl bg-[#e8f2ea] p-3 text-sm font-semibold">{msg}</p> : null}

          {(order.billFileDataUrl ||
            order.lrFileDataUrl ||
            order.lrNumber ||
            order.actualBillAmount != null ||
            order.packingSlip?.customerPdfUrl) && (
            <div className="rounded-2xl border-2 border-[var(--brand-deep)]/20 bg-white p-4 space-y-3">
              <h3 className="text-base font-bold text-[var(--brand-deep)]">
                {locale === "hi" ? "बिल / दस्तावेज़" : "Bill & documents"}
              </h3>
              {order.actualBillAmount != null ? (
                <p className="text-sm font-semibold">
                  {locale === "hi" ? "अंतिम बिल:" : "Final bill:"}{" "}
                  {formatInr(order.actualBillAmount, locale)}
                </p>
              ) : null}
              {order.lrNumber ? (
                <p className="text-sm font-semibold">
                  LR No: {order.lrNumber}
                </p>
              ) : null}
              <div className="flex flex-col gap-2">
                {order.billFileDataUrl ? (
                  <a
                    href={order.billFileDataUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="tt-btn tt-btn-dark w-full text-base font-bold"
                  >
                    {locale === "hi" ? "बिल देखें" : "View bill"}
                  </a>
                ) : null}
                {order.lrFileDataUrl ? (
                  <a
                    href={order.lrFileDataUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="tt-btn tt-btn-outline w-full text-base font-bold"
                  >
                    {locale === "hi" ? "LR देखें" : "View LR"}
                  </a>
                ) : null}
                {order.packingSlip?.customerPdfUrl ? (
                  <a
                    href={order.packingSlip.customerPdfUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="tt-btn tt-btn-outline w-full text-base font-bold"
                  >
                    {locale === "hi" ? "पैकिंग स्लिप देखें" : "View packing slip"}
                  </a>
                ) : null}
              </div>
            </div>
          )}

          {showCancel ? (
            <div className="rounded-2xl border border-[var(--danger)]/30 bg-white p-4 space-y-3">
              <h3 className="font-semibold text-[var(--danger)]">
                {t("common.cancelOrder")}
              </h3>
              <p className="text-xs text-[var(--ink-muted)]">
                {locale === "hi"
                  ? "डिस्पैच से पहले एडमिन ऑर्डर रद्द कर सकता है। वॉलेट क्रेडिट वापस होगा।"
                  : "Admin can cancel before dispatch. Wallet credit used will be refunded."}
              </p>
              <textarea
                className="tt-textarea"
                placeholder={
                  locale === "hi" ? "कारण (वैकल्पिक)" : "Reason (optional)"
                }
                value={cancelNote}
                onChange={(e) => setCancelNote(e.target.value)}
              />
              <button
                type="button"
                className="tt-btn w-full border-2 border-[var(--danger)] bg-white text-base font-bold text-[var(--danger)]"
                onClick={onCancelOrder}
              >
                {t("common.cancelOrder")}
              </button>
            </div>
          ) : null}

          {order.status === "cancelled" ? (
            <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface-2)] p-4 text-sm">
              <p className="font-semibold">
                {t("orderStatus.cancelled")}
              </p>
              <p className="mt-1 text-[var(--ink-muted)]">
                {order.timeline.filter((x) => x.status === "cancelled").at(-1)
                  ?.note || "—"}
              </p>
            </div>
          ) : null}

          {(isOwner || canManage) &&
          (order.status === "estimate" || order.status === "confirmed") ? (
            <div className="rounded-2xl border-2 border-[var(--brand-deep)]/20 bg-white p-4">
              <h3 className="text-base font-bold text-[var(--brand-deep)]">
                {t("shop.waitingBillTitle")}
              </h3>
              <p className="mt-1 text-sm text-[var(--ink-muted)]">
                {t("shop.waitingBillBody")}
              </p>
            </div>
          ) : null}

          <div id="pay-now" className="scroll-mt-24 space-y-6">
          {(isOwner || canManage) &&
          (order.status === "payment_pending" ||
            order.status === "payment_verified") &&
          (() => {
            const due = paymentAmountDue(order);
            const rem = proofRemaining(order.paymentProof, due);
            if (rem <= 0 && order.status === "payment_verified") {
              return null;
            }
            if (rem <= 0) return null;
            // QR / UPI amount = what user typed for this payment (capped), else full remaining
            const typed = Number(proofAmount);
            const thisPay =
              Number.isFinite(typed) && typed > 0
                ? Math.min(typed, rem)
                : rem;
            const payRef = nextPayRefFromItems(
              order.orderNumber,
              getProofItems(order.paymentProof)
            );
            return (
              <PaymentInstructions
                settings={db.settings}
                amount={thisPay}
                remainingBalance={rem}
                orderNumber={order.orderNumber}
                payRef={payRef}
                locale={locale}
              />
            );
          })()}

          {(() => {
            const items = getProofItems(order.paymentProof);
            const amountDue = paymentAmountDue(order);
            const paidSoFar = proofPaidTotal(order.paymentProof);
            const remaining = proofRemaining(order.paymentProof, amountDue);
            const isVerified = !!order.paymentProof?.verified;
            const canUploadMore =
              isOwner && !isVerified && order.status === "payment_pending";
            if (!items.length && !canUploadMore) return null;

            return (
              <div className="rounded-2xl border-2 border-[var(--brand)]/30 bg-white p-4 space-y-4">
                <div>
                  <h3 className="text-base font-bold text-[var(--brand-deep)]">
                    {locale === "hi"
                      ? "पेमेंट प्रूफ"
                      : "Payment proof"}
                  </h3>
                  <p className="text-xs text-[var(--ink-muted)]">
                    {locale === "hi"
                      ? "पूरा भुगतान एक बार में या हिस्सों में — हर पेमेंट के लिए स्क्रीनशॉट/रसीद अपलोड करें।"
                      : "Full or part-payments — upload a screenshot/receipt for each transaction."}
                  </p>
                </div>

                {items.length ? (
                  <div className="rounded-xl bg-[var(--surface)] px-3 py-2 text-xs">
                    <div className="flex items-baseline justify-between">
                      <span className="text-[var(--ink-muted)]">
                        {locale === "hi" ? "भुगतान कुल" : "Total paid"}
                      </span>
                      <span className="font-bold tabular-nums text-[var(--ok)]">
                        {formatInr(paidSoFar, locale)}
                      </span>
                    </div>
                    <div className="mt-1 flex items-baseline justify-between">
                      <span className="text-[var(--ink-muted)]">
                        {locale === "hi" ? "बाकी" : "Remaining"}
                      </span>
                      <span
                        className={`font-bold tabular-nums ${
                          remaining <= 0
                            ? "text-[var(--ok)]"
                            : "text-[var(--danger)]"
                        }`}
                      >
                        {formatInr(remaining, locale)}
                      </span>
                    </div>
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--surface-2)]">
                      <div
                        className="h-full bg-[var(--ok)] transition-all"
                        style={{
                          width: amountDue > 0
                            ? `${Math.min(100, (paidSoFar / amountDue) * 100)}%`
                            : "0%",
                        }}
                      />
                    </div>
                    {paidSoFar > 0 && remaining <= 0 ? (
                      <p className="mt-1 text-center text-[10px] font-semibold uppercase tracking-wide text-[var(--ok)]">
                        {isVerified
                          ? locale === "hi"
                            ? "पेड"
                            : "Paid"
                          : locale === "hi"
                            ? "पूरा भुगतान"
                            : "Fully paid"}
                      </p>
                    ) : paidSoFar > 0 ? (
                      <p className="mt-1 text-center text-[10px] font-semibold uppercase tracking-wide text-[var(--brand-deep)]">
                        {locale === "hi" ? "पार्ट पेड" : "Part paid"}
                      </p>
                    ) : null}
                  </div>
                ) : null}

                {items.length ? (
                  <ul className="space-y-2">
                    {items.map((it) => (
                      <li
                        key={it.id}
                        className="flex items-start gap-3 rounded-xl border border-[var(--line)] bg-white p-2"
                      >
                        <div className="h-16 w-16 shrink-0 overflow-hidden rounded-lg border border-[var(--line)] bg-[var(--surface-2)]">
                          {it.type === "image" ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={it.url}
                              alt={it.fileName || "proof"}
                              className="h-full w-full object-cover"
                            />
                          ) : (
                            <div className="flex h-full w-full items-center justify-center text-[10px] font-bold text-[var(--ink-muted)]">
                              PDF
                            </div>
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-baseline justify-between gap-2">
                            <p className="truncate text-sm font-semibold text-[var(--ink)]">
                              {it.fileName ||
                                (locale === "hi" ? "फ़ाइल" : "File")}
                            </p>
                            {typeof it.amount === "number" && it.amount > 0 ? (
                              <p className="text-sm font-bold text-[var(--ok)] tabular-nums">
                                {formatInr(it.amount, locale)}
                              </p>
                            ) : null}
                          </div>
                          {it.payRef ? (
                            <p className="mt-0.5 font-mono text-xs font-semibold text-[var(--brand-deep)]">
                              {it.payRef}
                            </p>
                          ) : null}
                          {it.note ? (
                            <p className="mt-0.5 break-words text-xs text-[var(--ink-muted)]">
                              {locale === "hi" ? "UTR / नोट: " : "UTR / note: "}
                              {it.note}
                            </p>
                          ) : null}
                          <p className="mt-0.5 text-[11px] text-[var(--ink-muted)]">
                            {new Date(it.uploadedAt).toLocaleString(
                              locale === "hi" ? "hi-IN" : "en-IN",
                              {
                                day: "2-digit",
                                month: "short",
                                hour: "2-digit",
                                minute: "2-digit",
                              }
                            )}
                          </p>
                          <div className="mt-1 flex flex-wrap gap-3 text-xs">
                            <a
                              href={it.url}
                              target="_blank"
                              rel="noreferrer"
                              className="font-semibold text-[var(--brand)] underline underline-offset-2"
                            >
                              {locale === "hi" ? "देखें" : "View"}
                            </a>
                            {(isOwner && !isVerified) || canManage ? (
                              <button
                                type="button"
                                className="font-semibold text-[var(--danger)] underline underline-offset-2"
                                onClick={() => {
                                  if (
                                    !session ||
                                    !confirm(
                                      locale === "hi"
                                        ? "यह फ़ाइल हटाएँ?"
                                        : "Remove this file?"
                                    )
                                  ) {
                                    return;
                                  }
                                  try {
                                    removePaymentProofItem(
                                      order.id,
                                      it.id,
                                      session.id
                                    );
                                    refresh();
                                  } catch (err) {
                                    setMsg(
                                      err instanceof Error
                                        ? err.message
                                        : "Remove failed"
                                    );
                                  }
                                }}
                              >
                                {locale === "hi" ? "हटाएँ" : "Remove"}
                              </button>
                            ) : null}
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : null}

                {canUploadMore ? (
                  <form
                    onSubmit={onProof}
                    className="space-y-3 border-t border-[var(--line)] pt-4"
                  >
                    <FilePick
                      kind="photoOrPdf"
                      multiple
                      value={proofFiles}
                      onChange={setProofFiles}
                      label={
                        items.length
                          ? locale === "hi"
                            ? "और प्रूफ जोड़ें"
                            : "Add more proofs"
                          : locale === "hi"
                            ? "पेमेंट प्रूफ"
                            : "Payment proof"
                      }
                    />
                    <div className="grid gap-2 sm:grid-cols-2">
                      <div>
                        <label className="tt-label">
                          {locale === "hi"
                            ? "इस पेमेंट की रकम ₹ *"
                            : "Amount paid this time ₹ *"}
                        </label>
                        <NumberField
                          step="0.01"
                          min={0.01}
                          max={remaining > 0 ? remaining : undefined}
                          required
                          emptyAs={null}
                          className="tt-input"
                          placeholder={
                            remaining > 0
                              ? locale === "hi"
                                ? `अधिकतम ${formatInr(remaining, locale)}`
                                : `Max ${formatInr(remaining, locale)}`
                              : locale === "hi"
                                ? "रकम"
                                : "Amount"
                          }
                          value={proofAmount}
                          onValueChange={(v) => {
                            if (v === "") {
                              setProofAmount("");
                              return;
                            }
                            if (remaining > 0 && v > remaining) {
                              setProofAmount(
                                String(Math.round(remaining * 100) / 100)
                              );
                              return;
                            }
                            setProofAmount(String(v));
                          }}
                          onBlur={() => {
                            if (proofAmount === "") return;
                            const n = Number(proofAmount);
                            if (
                              Number.isFinite(n) &&
                              remaining > 0 &&
                              n > remaining
                            ) {
                              setProofAmount(
                                String(Math.round(remaining * 100) / 100)
                              );
                            }
                          }}
                        />
                        {remaining > 0 ? (
                          <p className="mt-1 text-[11px] text-[var(--ink-muted)]">
                            {locale === "hi"
                              ? `बाकी बैलेंस: ${formatInr(remaining, locale)} — इससे ज़्यादा नहीं डाल सकते`
                              : `Balance left: ${formatInr(remaining, locale)} — cannot enter more`}
                          </p>
                        ) : null}
                      </div>
                      <div>
                        <label className="tt-label">
                          {locale === "hi"
                            ? "UPI ref / नोट (वैकल्पिक)"
                            : "UPI ref / note (optional)"}
                        </label>
                        <input
                          type="text"
                          className="tt-input"
                          placeholder={
                            locale === "hi"
                              ? "UPI ref / बैंक नोट"
                              : "UPI ref / bank note"
                          }
                          value={proofNote}
                          onChange={(e) => setProofNote(e.target.value)}
                        />
                      </div>
                    </div>
                    <button
                      type="submit"
                      disabled={
                        proofBusy || !proofFiles.length || !proofAmount
                      }
                      className="tt-btn tt-btn-dark w-full text-base font-bold disabled:opacity-60"
                    >
                      {proofBusy
                        ? locale === "hi"
                          ? "अपलोड हो रहा है…"
                          : "Uploading…"
                        : items.length
                          ? locale === "hi"
                            ? "और अपलोड करें"
                            : "Upload more"
                          : locale === "hi"
                            ? "पेमेंट प्रूफ अपलोड करें"
                            : "Upload payment proof"}
                    </button>
                    {remaining > 0 && paidSoFar > 0 ? (
                      <p className="rounded-lg bg-[var(--surface-2)] px-3 py-2 text-[11px] text-[var(--ink)]">
                        {locale === "hi"
                          ? `बाकी ${formatInr(remaining, locale)} — जब यह पूरा हो जाए, तब एडमिन वेरिफाई करेगा।`
                          : `${formatInr(remaining, locale)} still outstanding — admin will verify once fully paid.`}
                      </p>
                    ) : null}
                  </form>
                ) : null}

                {items.length ? (
                  <div className="flex flex-col gap-2 border-t border-[var(--line)] pt-3">
                    {isVerified ? (
                      <button
                        type="button"
                        className="tt-btn w-full cursor-default text-base font-bold text-white"
                        style={{
                          background: "var(--ok)",
                          borderColor: "var(--ok)",
                        }}
                        disabled
                      >
                        {locale === "hi" ? "✓ वेरिफाइड" : "✓ Verified"}
                      </button>
                    ) : canVerify ? (
                      <button
                        type="button"
                        className="tt-btn tt-btn-dark w-full text-base font-bold"
                        onClick={() => {
                          if (
                            remaining > 0 &&
                            !confirm(
                              locale === "hi"
                                ? `अभी भी ${formatInr(remaining, locale)} बाकी है। Force-verify करें?`
                                : `${formatInr(remaining, locale)} still outstanding. Force-verify anyway?`
                            )
                          ) {
                            return;
                          }
                          if (
                            remaining <= 0 &&
                            !confirm(
                              locale === "hi"
                                ? "पेमेंट वेरिफाई करें?"
                                : "Mark payment as verified?"
                            )
                          ) {
                            return;
                          }
                          try {
                            verifyPayment(order.id, session!.id, {
                              force: remaining > 0,
                            });
                            setMsg(
                              locale === "hi"
                                ? "पेमेंट वेरिफाइड हो गया"
                                : "Payment verified"
                            );
                            refresh();
                            tryNotify("payment_verified");
                          } catch (err) {
                            setMsg(
                              err instanceof Error
                                ? err.message
                                : "Verify failed"
                            );
                          }
                        }}
                      >
                        {locale === "hi"
                          ? "पेमेंट वेरिफाई करें"
                          : "Verify payment"}
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="tt-btn w-full cursor-default text-base font-bold"
                        style={{
                          background: "var(--surface-2)",
                          color: "var(--ink-muted)",
                          borderColor: "var(--line)",
                        }}
                        disabled
                      >
                        {locale === "hi"
                          ? "वेरिफिकेशन बाकी"
                          : "Awaiting verification"}
                      </button>
                    )}
                    {isVerified && order.paymentProof?.verifiedAt ? (
                      <p className="text-xs text-[var(--ink-muted)]">
                        {locale === "hi" ? "वेरिफाइड:" : "Verified:"}{" "}
                        {new Date(order.paymentProof.verifiedAt).toLocaleString(
                          locale === "hi" ? "hi-IN" : "en-IN"
                        )}
                      </p>
                    ) : null}
                  </div>
                ) : null}
              </div>
            );
          })()}
          </div>

          {canManage ? (
            <div className="rounded-2xl border-2 border-[var(--line)] bg-white p-4 space-y-3">
              <h3 className="text-base font-bold text-[var(--brand-deep)]">
                {t("common.whatsapp")}
              </h3>
              <p className="text-xs text-[var(--ink-muted)]">
                {locale === "hi"
                  ? "कन्फर्म / बिल / डिस्पैच / LR / डिलीवर पर मैसेज अपने आप जाता है। फिर से भेजने के लिए नीचे दबाएँ।"
                  : "Confirm, bill ready, dispatch, LR and delivered send automatically. Use this to resend."}
              </p>
              <button
                type="button"
                className="tt-btn tt-btn-outline w-full text-base font-bold"
                onClick={() => {
                  void notifyOrderWhatsApp({
                    order,
                    status: order.status,
                    settings: db.settings,
                    users: db.users,
                    locale,
                  }).then((result) => {
                    setMsg(
                      whatsappResultCopy(result, {
                        sent: t("common.whatsappSent"),
                        opened: t("common.whatsappOpened"),
                        fail: t("common.whatsappSendFailed"),
                        noPhone: t("common.whatsappNoPhone"),
                      })
                    );
                  });
                }}
              >
                {t("common.sendWhatsApp")}
              </button>
              {orderHasLr(order) ? (
                <button
                  type="button"
                  className="tt-btn tt-btn-outline w-full text-base font-bold"
                  onClick={() => sendLrToDealer(order)}
                >
                  {locale === "hi" ? "LR WhatsApp पर भेजें" : "Send LR on WhatsApp"}
                </button>
              ) : null}
            </div>
          ) : null}

          {canManage && !canLr && order.status === "payment_verified" ? (
            <div className="rounded-2xl border-2 border-[var(--brand-deep)]/30 bg-white p-4 space-y-3">
              <h3 className="text-base font-bold text-[var(--brand-deep)]">
                {locale === "hi" ? "डिस्पैच" : "Dispatch"}
              </h3>
              <p className="text-xs text-[var(--ink-muted)]">
                {locale === "hi"
                  ? "पहले डिस्पैच करें। LR अलग से बाद में अपलोड होगा।"
                  : "Mark dispatched first. LR is uploaded separately after that."}
              </p>
              <button
                type="button"
                className="tt-btn tt-btn-dark w-full text-base font-bold"
                onClick={onDispatch}
              >
                {locale === "hi" ? "डिस्पैच करें" : "Mark dispatched"}
              </button>
            </div>
          ) : null}

          {(canBill || canManage) && order.status !== "cancelled" ? (
            <form
              onSubmit={onSaveFinalKgBill}
              className="rounded-2xl border-2 border-[var(--brand-deep)]/25 bg-white p-4 space-y-3"
            >
              <h3 className="text-base font-bold text-[var(--brand-deep)]">
                {locale === "hi"
                  ? "असली वजन + अंतिम बिल"
                  : "Final kg + bill"}
              </h3>
              {order.packingSlip?.status === "finalized" ? (
                <p className="rounded-lg border border-amber-400/50 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900">
                  {locale === "hi"
                    ? "पैकिंग स्लिप फाइनल है — ये फ़ील्ड लॉक हैं। बदलने के लिए पैकिंग स्लिप फिर खोलें।"
                    : "Packing slip is finalized — these fields are locked. Reopen the packing slip to edit."}
                </p>
              ) : (
                <p className="text-xs text-[var(--ink-muted)]">
                  {locale === "hi"
                    ? "हर आइटम का असली kg डालें — बिल रेट × kg से अपने आप बनेगा। स्कीम भी इसी से अपडेट होगी।"
                    : "Enter actual kg per item — bill is auto from rate × kg. Schemes use the same weights."}
                </p>
              )}
              <div className="space-y-2">
                <p className="tt-label">
                  {locale === "hi"
                    ? "आइटम असली वजन (kg) *"
                    : "Item actual weight (kg) *"}
                </p>
                {order.lines.map((l, i) => {
                  const kg = Number(lineWeights[i]);
                  const lineAmt =
                    kg > 0
                      ? calcLineTotal({
                          pricingMode: l.pricingMode,
                          rate: l.rate,
                          quantity: l.quantity,
                          weightKg: kg,
                        })
                      : null;
                  const slipLocked =
                    order.packingSlip?.status === "finalized";
                  return (
                    <div
                      key={`${l.productId}-${i}`}
                      className="rounded-lg border border-[var(--line)] bg-[var(--surface)] p-3"
                    >
                      <p className="text-sm font-semibold">
                        {l.productName[locale]}
                        <span className="ml-1 text-xs font-normal text-[var(--ink-muted)]">
                          × {l.quantity}
                          {l.pricingMode === "bundle"
                            ? ` · ${formatInr(l.rate, locale)}/${t("common.kg")}`
                            : ` · ${formatInr(l.rate, locale)}/pc`}
                        </span>
                      </p>
                      <p className="mt-0.5 text-[11px] text-[var(--ink-muted)]">
                        {locale === "hi" ? "अनुमान:" : "Estimate:"}{" "}
                        {l.estimatedWeightKg ?? l.weightKg} {t("common.kg")}
                        {lineAmt != null
                          ? ` · ${locale === "hi" ? "लाइन:" : "Line:"} ${formatInr(lineAmt, locale)}`
                          : ""}
                      </p>
                      <div className="mt-2 flex items-center gap-2">
                        <NumberField
                          className="tt-input flex-1 disabled:cursor-not-allowed disabled:opacity-60"
                          min={0.01}
                          step="0.01"
                          emptyAs={null}
                          placeholder={
                            locale === "hi" ? "असली kg" : "Actual kg"
                          }
                          value={lineWeights[i] ?? ""}
                          onValueChange={(v) =>
                            setLineWeightAt(i, v === "" ? "" : String(v))
                          }
                          required={!slipLocked}
                          disabled={slipLocked}
                          readOnly={slipLocked}
                        />
                        <span className="shrink-0 text-xs font-semibold text-[var(--ink-muted)]">
                          {t("common.kg")}
                        </span>
                      </div>
                    </div>
                  );
                })}
                <p className="text-[11px] text-[var(--ink-muted)]">
                  {locale === "hi" ? "कुल असली:" : "Total actual:"}{" "}
                  {roundLineWeightTotal(lineWeights)} {t("common.kg")}
                  {order.actualWeightKg != null
                    ? ` · ${locale === "hi" ? "सेव:" : "Saved:"} ${order.actualWeightKg} ${t("common.kg")}`
                    : ""}
                </p>
              </div>

              <div className="rounded-xl border border-[var(--line)] bg-[var(--surface)] px-3 py-3">
                <p className="text-[11px] uppercase tracking-wide text-[var(--ink-muted)]">
                  {locale === "hi"
                    ? "अंतिम बिल (kg से)"
                    : "Actual bill (from kg)"}
                </p>
                <p className="mt-1 text-2xl font-bold tabular-nums text-[var(--brand-deep)]">
                  {liveBill
                    ? formatInr(liveBill.grossBill, locale)
                    : order.actualBillAmount != null
                      ? formatInr(order.actualBillAmount, locale)
                      : "—"}
                </p>
                {liveBill ? (
                  <p className="mt-1 text-[11px] text-[var(--ink-muted)]">
                    {locale === "hi" ? "सबटोटल" : "Subtotal"}{" "}
                    {formatInr(liveBill.subtotal, locale)}
                    {liveBill.shippingAmount > 0
                      ? ` + ${locale === "hi" ? "शिपिंग" : "ship"} ${formatInr(liveBill.shippingAmount, locale)}`
                      : ""}
                    {liveBill.walletUsed > 0
                      ? ` · ${locale === "hi" ? "बकाया" : "due"} ${formatInr(liveBill.billAmount, locale)}`
                      : ""}
                  </p>
                ) : order.packingSlip?.status === "finalized" ? (
                  <p className="mt-1 text-[11px] text-[var(--ink-muted)]">
                    {locale === "hi"
                      ? "बिल पैकिंग स्लिप से लॉक है"
                      : "Bill locked from packing slip"}
                  </p>
                ) : (
                  <p className="mt-1 text-[11px] text-[var(--ink-muted)]">
                    {locale === "hi"
                      ? "सभी लाइनों में kg भरें"
                      : "Fill kg on every line to see bill"}
                  </p>
                )}
                {order.actualBillAmount != null ? (
                  <p className="mt-1 text-[11px] text-[var(--ink-muted)]">
                    {locale === "hi" ? "सेव्ड बिल:" : "Saved bill:"}{" "}
                    {formatInr(order.actualBillAmount, locale)}
                  </p>
                ) : null}
              </div>

              <div>
                <FilePick
                  kind="photoOrPdf"
                  value={billFile}
                  onChange={(files) => setBillFile(files[0] ?? null)}
                  disabled={order.packingSlip?.status === "finalized"}
                  label={
                    locale === "hi"
                      ? "बिल स्कैन / PDF (वैकल्पिक)"
                      : "Bill scan / PDF (optional)"
                  }
                />
              </div>
              {order.packingSlip?.status !== "finalized" ? (
                <>
                  <button
                    type="submit"
                    className="tt-btn tt-btn-dark w-full text-base font-bold"
                    disabled={!liveBill}
                  >
                    {locale === "hi"
                      ? "असली kg + बिल सेव करें"
                      : "Save final kg & bill"}
                  </button>
                </>
              ) : canManage ? (
                <Link
                  href={`/admin/orders/${order.id}/packing-slip`}
                  className="tt-btn tt-btn-outline w-full text-center"
                >
                  {locale === "hi"
                    ? "पैकिंग स्लिप खोलें / फिर खोलें"
                    : "Open / reopen packing slip"}
                </Link>
              ) : null}
            </form>
          ) : null}

          {canLr &&
          (order.status === "dispatched" || order.status === "delivered") ? (
            <form
              onSubmit={onLr}
              className={`rounded-2xl border-2 bg-white p-4 space-y-3 ${
                pendingLr
                  ? "border-amber-500/50"
                  : "border-[var(--line)]"
              }`}
            >
              <h3 className="text-base font-bold text-[var(--brand-deep)]">
                {pendingLr
                  ? locale === "hi"
                    ? "LR अपलोड → डिलीवर"
                    : "Upload LR → delivered"
                  : locale === "hi"
                    ? "LR अपडेट करें"
                    : "Update LR"}
              </h3>
              <p className="text-xs text-[var(--ink-muted)]">
                {pendingLr
                  ? locale === "hi"
                    ? "LR सेव होते ही ऑर्डर डिलीवर मार्क होगा।"
                    : "Saving LR marks the order delivered."
                  : locale === "hi"
                    ? "LR नंबर और/या स्कैन (फोटो/PDF) अपडेट करें।"
                    : "Update LR number and/or scan (photo/PDF)."}
              </p>
              <input
                className="tt-input"
                placeholder="LR number"
                value={lrNumber}
                onChange={(e) => setLrNumber(e.target.value)}
              />
              <FilePick
                kind="photoOrPdf"
                value={lrFile}
                onChange={(files) => setLrFile(files[0] ?? null)}
                label={locale === "hi" ? "LR स्कैन" : "LR scan"}
              />
              {order.lrFileDataUrl ? (
                <a
                  href={order.lrFileDataUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-block text-xs font-bold text-[var(--brand-deep)] underline"
                >
                  {locale === "hi" ? "मौजूदा LR देखें" : "View current LR"}
                </a>
              ) : null}
              <button
                type="submit"
                className="tt-btn tt-btn-dark w-full text-base font-bold"
              >
                {pendingLr
                  ? locale === "hi"
                    ? "LR सेव · डिलीवर मार्क"
                    : "Save LR · mark delivered"
                  : locale === "hi"
                    ? "LR सेव करें"
                    : "Save LR"}
              </button>
            </form>
          ) : null}

          {canLr && order.status === "payment_verified" ? (
            <div className="rounded-2xl border-2 border-amber-500/40 bg-amber-50/50 p-4 space-y-3">
              <h3 className="text-base font-bold text-[var(--brand-deep)]">
                {locale === "hi" ? "LR → डिलीवर" : "LR → delivered"}
              </h3>
              <p className="text-xs text-[var(--ink-muted)]">
                {locale === "hi"
                  ? "LR नंबर/फाइल सेव करने पर ऑर्डर डिलीवर मार्क होगा। बिना LR केवल डिस्पैच भी कर सकते हैं।"
                  : "Saving LR marks the order delivered. Or dispatch without LR first."}
              </p>
              <input
                className="tt-input"
                placeholder="LR number"
                value={lrNumber}
                onChange={(e) => setLrNumber(e.target.value)}
              />
              <FilePick
                kind="photoOrPdf"
                value={lrFile}
                onChange={(files) => setLrFile(files[0] ?? null)}
                label={locale === "hi" ? "LR स्कैन" : "LR scan"}
              />
              <button
                type="button"
                className="tt-btn tt-btn-dark w-full text-base font-bold"
                disabled={!lrNumber.trim() && !lrFile}
                onClick={() => {
                  void (async () => {
                    try {
                      let lrFileDataUrl: string | undefined;
                      if (lrFile) {
                        const up = await uploadMediaFile(lrFile, "lr");
                        lrFileDataUrl = up.url;
                      }
                      const saved = uploadLr(order.id, { lrNumber, lrFileDataUrl });
                      setLrFile(null);
                      sendLrToDealer(saved, lrFileDataUrl);
                      refresh();
                    } catch (err) {
                      setMsg(
                        err instanceof Error ? err.message : "LR save failed"
                      );
                    }
                  })();
                }}
              >
                {locale === "hi"
                  ? "LR सेव · डिलीवर मार्क"
                  : "Save LR · mark delivered"}
              </button>
              <button
                type="button"
                className="tt-btn tt-btn-outline w-full text-sm"
                onClick={() => {
                  try {
                    markOrderDispatched(order.id);
                    setMsg(
                      locale === "hi" ? "डिस्पैच हो गया" : "Dispatched"
                    );
                    refresh();
                    tryNotify(
                      "dispatched",
                      undefined,
                      locale === "hi" ? "LR अपलोड बाकी" : "LR upload pending"
                    );
                  } catch (err) {
                    setMsg(
                      err instanceof Error ? err.message : "Dispatch failed"
                    );
                  }
                }}
              >
                {locale === "hi"
                  ? "केवल डिस्पैच (बिना LR)"
                  : "Dispatch only (no LR)"}
              </button>
            </div>
          ) : null}

          {canManage ? (
            <div className="rounded-2xl border-2 border-[var(--line)] bg-white p-4 space-y-3">
              <h3 className="text-base font-bold text-[var(--brand-deep)]">
                {locale === "hi" ? "स्टेटस अपडेट" : "Update status"}
              </h3>
              <select
                className="tt-select font-semibold"
                value={order.status}
                onChange={(e) => {
                  const status = e.target.value as OrderStatus;
                  try {
                    updateOrderStatus(order.id, status);
                    setMsg(
                      locale === "hi"
                        ? `स्टेज: ${timelineStatusLabel(status, locale)}`
                        : `Stage: ${timelineStatusLabel(status, locale)}`
                    );
                    refresh();
                    tryNotify(status);
                  } catch (err) {
                    setMsg(
                      err instanceof Error ? err.message : "Status update failed"
                    );
                  }
                }}
              >
                {allowedNextOrderStatuses(order.status).map((s) => (
                  <option key={s} value={s}>
                    {t(`orderStatus.${s}` as "orderStatus.estimate")}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
        </aside>
        </div>
      </div>
    </section>
  );
}
