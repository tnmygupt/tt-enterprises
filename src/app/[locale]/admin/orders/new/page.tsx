"use client";

import { FormEvent, useMemo, useState } from "react";
import { TransportInput } from "@/components/TransportInput";
import { useLocale, useTranslations } from "next-intl";
import { Link, useRouter } from "@/i18n/routing";
import { AdminAccessDenied } from "@/components/AdminAccessDenied";
import { AdminShell } from "@/components/AdminShell";
import { NumberField } from "@/components/NumberField";
import { SearchSelect } from "@/components/SearchSelect";
import {
  catalogRowValue,
  getSizeColorStock,
  inventoryRows,
  parseCatalogRowValue,
} from "@/lib/inventory";
import { useDb, useSession } from "@/lib/hooks";
import {
  calcLineTotal,
  formatInr,
  resolveRate,
  resolveWeightKg,
  roundOffRupees,
} from "@/lib/pricing";
import {
  adminPunchOrderAndSync,
  calcShipping,
  countOrderJhals,
  checkCapability,
  shippingWeightExcludingJhal,
} from "@/lib/store/db";
import { pickBestOrderDiscount } from "@/lib/schemes";
import type {
  CartItem,
  OrderLine,
  Product,
  ProductVariation,
  UserProfile,
} from "@/lib/types";

interface PunchRow {
  id: string;
  productId: string;
  variationId: string;
  colorId: string;
  quantity: number;
  actualWeightKg: string;
}

function emptyRow(): PunchRow {
  return {
    id: crypto.randomUUID(),
    productId: "",
    variationId: "",
    colorId: "",
    quantity: 1,
    actualWeightKg: "",
  };
}

function stockLeft(
  product: Product | undefined,
  variation: ProductVariation | undefined,
  colorId: string | undefined,
  rows: PunchRow[],
  rowId: string
): number {
  if (!product || !variation) return 0;
  const cid = colorId || product.colors[0]?.id || "";
  const total = getSizeColorStock(product, variation.id, cid || undefined);
  const inOtherRows = rows
    .filter(
      (r) =>
        r.id !== rowId &&
        r.productId === product.id &&
        (r.variationId || "") === variation.id &&
        (r.colorId || "") === cid
    )
    .reduce((s, r) => s + Math.max(0, r.quantity || 0), 0);
  return Math.max(0, total - inOtherRows);
}

export default function AdminPunchOrderPage() {
  const t = useTranslations();
  const locale = useLocale() as "en" | "hi";
  const router = useRouter();
  const { db, refresh } = useDb();
  const { session } = useSession();

  const [dealerId, setDealerId] = useState<string>("");
  const [rows, setRows] = useState<PunchRow[]>([emptyRow()]);
  const [addressOverride, setAddressOverride] = useState("");
  const [transportOverride, setTransportOverride] = useState("");
  const [notes, setNotes] = useState("");
  const [walletToUse, setWalletToUse] = useState(0);
  const [billNow, setBillNow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const canManage = session && checkCapability(session, db?.users, "manage_orders");

  const dealers = useMemo<UserProfile[]>(() => {
    if (!db) return [];
    return db.users
      .filter((u) => u.role === "customer" && u.active && u.approved)
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [db]);

  const dealerOptions = useMemo(
    () =>
      dealers.map((u) => ({
        value: u.id,
        label: `${u.name} · ${u.phone}${u.company ? ` · ${u.company}` : ""}`,
        searchText: `${u.name} ${u.phone} ${u.company || ""}`,
      })),
    [dealers]
  );

  const dealer = dealers.find((u) => u.id === dealerId);

  const catalogOptions = useMemo(() => {
    if (!db) return [];
    return inventoryRows(db)
      .filter((c) => c.stock > 0)
      .map((c) => {
        const used = rows.reduce((s, r) => {
          if (
            r.productId === c.productId &&
            (r.variationId || "") === (c.variationId || "") &&
            (r.colorId || "") === (c.colorId || "")
          ) {
            return s + Math.max(0, r.quantity || 0);
          }
          return s;
        }, 0);
        const remaining = Math.max(0, c.stock - used);
        return {
          value: catalogRowValue(c),
          label: `${c.sku} · ${c.name} (${remaining}/${c.stock} bdl)`,
          searchText: `${c.sku} ${c.name} ${c.code}`,
        };
      });
  }, [db, rows]);

  const computed = useMemo(() => {
    const products = db?.products ?? [];
    return rows.map((row) => {
      const product = products.find((p) => p.id === row.productId);
      const variation = product?.variations.find(
        (v) => v.id === row.variationId
      );
      const color = product?.colors.find((c) => c.id === row.colorId);
      const stock = stockLeft(product, variation, color?.id, rows, row.id);
      const clampedQty = Math.max(
        0,
        Math.min(Math.max(0, row.quantity || 0), stock)
      );
      const rate =
        product && variation ? resolveRate(product, variation) : 0;
      const weightKg =
        product && variation
          ? resolveWeightKg(product, variation, clampedQty)
          : 0;
      const lineTotal =
        product && variation
          ? calcLineTotal({
              pricingMode: product.pricingMode,
              rate,
              quantity: clampedQty,
              weightKg,
            })
          : 0;
      return {
        row,
        product,
        variation,
        color,
        stock,
        qty: clampedQty,
        rate,
        weightKg,
        lineTotal,
      };
    });
  }, [rows, db]);

  const totals = useMemo(() => {
    const validLines = computed.filter((c) => c.product && c.variation && c.qty > 0);
    const subtotal = validLines.reduce((s, c) => s + c.lineTotal, 0);
    const shipLines = validLines.map((c) => ({
      productId: c.product!.id,
      unit: c.product!.unit,
      quantity: c.qty,
      weightKg: c.weightKg,
    }));
    const totalWeight = db
      ? shippingWeightExcludingJhal(shipLines, db.products)
      : validLines.reduce((s, c) => s + c.weightKg, 0);
    const jhalQty = db ? countOrderJhals(shipLines, db.products) : 0;
    const shipping = db ? calcShipping(db, subtotal, totalWeight, jhalQty) : 0;
    const orderLines: OrderLine[] = validLines.map((c) => ({
      productId: c.product!.id,
      productCode: c.product!.code,
      productName: c.product!.name,
      variationId: c.variation!.id,
      unit: c.product!.unit,
      pricingMode: c.product!.pricingMode,
      rate: c.rate,
      quantity: c.qty,
      weightKg: c.weightKg,
      estimatedWeightKg: c.weightKg,
      lineTotal: c.lineTotal,
    }));
    const schemeBest =
      db && dealer
        ? pickBestOrderDiscount(
            db.schemes,
            dealer.assignedSchemeIds,
            orderLines,
            db.products
          )
        : null;
    const schemeDiscount = schemeBest?.amount ?? 0;
    const maxWallet = Math.min(
      dealer?.walletBalance ?? 0,
      Math.max(0, subtotal + shipping - schemeDiscount)
    );
    const wallet = Math.max(0, Math.min(walletToUse, maxWallet));
    return {
      subtotal,
      totalWeight,
      shipping,
      schemeDiscount,
      schemeLabel:
        schemeBest?.scheme.name?.en || schemeBest?.scheme.name?.hi || "",
      wallet,
      // Matches adminPunchOrderAndSync, which stores a whole-rupee payable.
      grand: roundOffRupees(
        Math.max(0, subtotal + shipping - schemeDiscount - wallet)
      ),
      maxWallet,
    };
  }, [computed, db, dealer, walletToUse]);

  /** When billing now: actual kg → bill + shipping (not estimate kg). */
  const billFromKg = useMemo(() => {
    if (!billNow) return null;
    const validLines = computed.filter(
      (c) => c.product && c.variation && c.qty > 0
    );
    if (!validLines.length) return null;
    const weights = validLines.map((c) => {
      const explicit = Number(c.row.actualWeightKg);
      return Number.isFinite(explicit) && explicit > 0
        ? explicit
        : c.weightKg;
    });
    if (weights.some((w) => !(w > 0))) return null;
    const lineAmounts = validLines.map((c, i) =>
      calcLineTotal({
        pricingMode: c.product!.pricingMode,
        rate: c.rate,
        quantity: c.qty,
        weightKg: weights[i],
      })
    );
    const subtotal = lineAmounts.reduce((s, n) => s + n, 0);
    const shipLines = validLines.map((c, i) => ({
      productId: c.product!.id,
      unit: c.product!.unit,
      quantity: c.qty,
      weightKg: weights[i],
    }));
    const shipWeight = db
      ? shippingWeightExcludingJhal(shipLines, db.products)
      : weights.reduce((s, n) => s + n, 0);
    const jhalQty = db ? countOrderJhals(shipLines, db.products) : 0;
    const shippingAmount = db
      ? calcShipping(db, subtotal, shipWeight, jhalQty)
      : 0;
    const orderLines: OrderLine[] = validLines.map((c, i) => ({
      productId: c.product!.id,
      productCode: c.product!.code,
      productName: c.product!.name,
      variationId: c.variation!.id,
      unit: c.product!.unit,
      pricingMode: c.product!.pricingMode,
      rate: c.rate,
      quantity: c.qty,
      weightKg: weights[i],
      estimatedWeightKg: c.weightKg,
      actualWeightKg: weights[i],
      lineTotal: lineAmounts[i],
    }));
    const schemeBest =
      db && dealer
        ? pickBestOrderDiscount(
            db.schemes,
            dealer.assignedSchemeIds,
            orderLines,
            db.products
          )
        : null;
    const schemeDiscount = schemeBest?.amount ?? 0;
    const grossBill = roundOffRupees(
      Math.max(0, subtotal + shippingAmount - schemeDiscount)
    );
    const walletUsed = Math.min(totals.wallet, grossBill);
    return {
      lineAmounts,
      subtotal,
      shippingAmount,
      schemeDiscount,
      walletUsed,
      grossBill,
      billAmount: roundOffRupees(grossBill - walletUsed),
      totalKg: Math.round(weights.reduce((s, n) => s + n, 0) * 100) / 100,
      weights,
    };
  }, [billNow, computed, db, dealer, totals.wallet]);

  const setRow = (id: string, patch: Partial<PunchRow>) => {
    setRows((cur) =>
      cur.map((r) => (r.id === id ? { ...r, ...patch } : r))
    );
  };

  const removeRow = (id: string) => {
    setRows((cur) => (cur.length > 1 ? cur.filter((r) => r.id !== id) : cur));
  };

  const addRow = () => setRows((cur) => [...cur, emptyRow()]);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!session || !dealer) {
      setError(locale === "hi" ? "पहले डीलर चुनें" : "Pick a dealer first");
      return;
    }
    const valid = computed.filter(
      (c) => c.product && c.variation && c.qty > 0
    );
    if (!valid.length) {
      setError(
        locale === "hi"
          ? "कम से कम एक प्रोडक्ट जोड़ें"
          : "Add at least one product with quantity"
      );
      return;
    }
    if (billNow) {
      if (!billFromKg || !(billFromKg.grossBill > 0)) {
        setError(
          locale === "hi"
            ? "हर लाइन का असली kg डालें — बिल उसी से बनेगा"
            : "Enter actual kg on every line — bill is calculated from kg"
        );
        return;
      }
    }

    setBusy(true);
    setError("");
    try {
      const cart: CartItem[] = valid.map((c) => ({
        key: `${c.product!.id}:${c.variation!.id}:${c.color?.id ?? ""}`,
        productId: c.product!.id,
        variationId: c.variation!.id,
        colorId: c.color?.id || undefined,
        quantity: c.qty,
        weightKg: c.weightKg,
      }));

      const punchInput = {
        adminId: session.id,
        dealerId: dealer.id,
        cart,
        deliveryAddress: addressOverride.trim() || dealer.address || "",
        customerNotes: notes.trim() || undefined,
        checkoutName: dealer.name,
        gstOrAadhar: dealer.gstOrAadhar,
        phone: dealer.phone,
        transport: transportOverride.trim() || dealer.transport,
        walletToUse: totals.wallet,
        fullTruckRequested: false,
      };

      const order = billNow
        ? await adminPunchOrderAndSync({
            ...punchInput,
            billNow: {
              actualBillAmount: billFromKg!.grossBill,
              lineActualWeights: billFromKg!.weights,
            },
          })
        : await adminPunchOrderAndSync(punchInput);

      refresh();
      router.push(`/orders/${order.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Punch failed");
      setBusy(false);
    }
  };

  if (!session || !canManage) {
    return (
      <AdminShell>
        <AdminAccessDenied />
      </AdminShell>
    );
  }

  return (
    <AdminShell>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">
            {locale === "hi" ? "नया ऑर्डर पंच करें" : "Punch new order"}
          </h1>
          <p className="mt-1 text-sm text-[var(--ink-muted)]">
            {locale === "hi"
              ? "फ़ोन / वॉक-इन ऑर्डर डीलर की तरफ़ से बनाएँ। चाहें तो अभी बिल भी लगा दें।"
              : "Create phone / walk-in orders on behalf of a dealer. Optionally bill it in one step."}
          </p>
        </div>
        <Link href="/admin/orders" className="tt-btn tt-btn-outline">
          {locale === "hi" ? "वापस" : "Back"}
        </Link>
      </div>

      {error ? (
        <p className="mt-3 rounded-lg border border-[var(--danger)]/30 bg-[var(--danger)]/5 p-3 text-sm text-[var(--danger)]">
          {error}
        </p>
      ) : null}

      <form onSubmit={onSubmit} className="mt-6 space-y-6">
        {/* Dealer picker */}
        <section className="tt-panel p-5">
          <h2 className="font-semibold">
            {locale === "hi" ? "1. डीलर चुनें" : "1. Pick dealer"}
          </h2>
          <div className="mt-3">
            <SearchSelect
              options={dealerOptions}
              value={dealerId}
              onChange={(id) => {
                setDealerId(id);
                // Fill in what the dealer already told us at checkout so
                // staff confirm it rather than retype it.
                const picked = dealers.find((u) => u.id === id);
                setAddressOverride(picked?.address || "");
                setTransportOverride(picked?.transport || "");
              }}
              placeholder={
                locale === "hi" ? "नाम / फ़ोन खोजें…" : "Search name / phone…"
              }
              emptyLabel={locale === "hi" ? "डीलर" : "Dealer"}
              required
            />
          </div>
          {dealer ? (
            <div className="mt-3 grid gap-2 rounded-xl bg-[var(--surface-2)] p-3 text-sm sm:grid-cols-3">
              <div>
                <p className="text-xs uppercase text-[var(--ink-muted)]">
                  {t("common.wallet")}
                </p>
                <p className="font-semibold tabular-nums">
                  {formatInr(dealer.walletBalance, locale)}
                </p>
              </div>
              <div>
                <p className="text-xs uppercase text-[var(--ink-muted)]">
                  {locale === "hi" ? "पता" : "Address"}
                </p>
                <p className="text-sm">
                  {dealer.address || "—"}
                  {dealer.pincode ? ` · ${dealer.pincode}` : ""}
                </p>
              </div>
              <div>
                <p className="text-xs uppercase text-[var(--ink-muted)]">
                  GST / Aadhaar
                </p>
                <p className="text-sm">{dealer.gstOrAadhar || "—"}</p>
              </div>
            </div>
          ) : null}
        </section>

        {/* Product rows */}
        <section className="tt-panel p-5">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">
              {locale === "hi" ? "2. प्रोडक्ट डालें" : "2. Add products"}
            </h2>
            <button
              type="button"
              className="tt-btn tt-btn-outline"
              onClick={addRow}
            >
              {locale === "hi" ? "+ पंक्ति" : "+ Row"}
            </button>
          </div>
          <p className="mt-1 text-xs text-[var(--ink-muted)]">
            {locale === "hi"
              ? "स्टॉक वाले आइटम खोजें — साइज़ / रंग / SKU एक साथ।"
              : "Search in-stock items — size, colour, and SKU in one box."}
          </p>

          <div className="mt-4 space-y-3">
            {computed.map((c) => {
              const stockText =
                c.product && c.variation
                  ? `${c.stock} ${locale === "hi" ? "बंडल" : "bundles"}`
                  : "";
              const catalogValue =
                c.row.productId
                  ? catalogRowValue({
                      productId: c.row.productId,
                      variationId: c.row.variationId || undefined,
                      colorId: c.row.colorId || undefined,
                    })
                  : "";
              return (
                <div
                  key={c.row.id}
                  className="rounded-xl border border-[var(--line)] bg-white p-3"
                >
                  <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
                    <SearchSelect
                      options={catalogOptions}
                      value={catalogValue}
                      onChange={(val) => {
                        if (!val) {
                          setRow(c.row.id, {
                            productId: "",
                            variationId: "",
                            colorId: "",
                            quantity: 1,
                            actualWeightKg: "",
                          });
                          return;
                        }
                        const parsed = parseCatalogRowValue(val);
                        setRow(c.row.id, {
                          productId: parsed.productId,
                          variationId: parsed.variationId || "",
                          colorId: parsed.colorId || "",
                          quantity: 1,
                          actualWeightKg: "",
                        });
                      }}
                      placeholder={
                        locale === "hi"
                          ? "आइटम / साइज़ / रंग खोजें…"
                          : "Search item / size / colour…"
                      }
                      emptyLabel={locale === "hi" ? "आइटम" : "Item"}
                    />

                    <NumberField
                      integer
                      emptyAs={null}
                      inputMode="numeric"
                      className="tt-input w-24 tabular-nums"
                      value={c.row.quantity}
                      onValueChange={(v) => {
                        if (v === "") return;
                        setRow(c.row.id, {
                          quantity: Math.max(0, v),
                        });
                      }}
                      onBlur={() => {
                        setRow(c.row.id, {
                          quantity: Math.max(0, Math.trunc(c.row.quantity || 0)),
                        });
                      }}
                    />

                    <button
                      type="button"
                      className="rounded-lg border border-[var(--line)] px-3 text-[var(--danger)]"
                      onClick={() => removeRow(c.row.id)}
                      aria-label="Remove row"
                    >
                      ✕
                    </button>
                  </div>

                  {c.product && c.variation ? (
                    <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--ink-muted)]">
                      <span>
                        {c.color ? `${c.color.name[locale]} · ` : ""}
                        {locale === "hi" ? "रेट" : "Rate"}:{" "}
                        <strong className="text-[var(--ink)] tabular-nums">
                          {formatInr(c.rate, locale)}
                        </strong>{" "}
                        · {c.weightKg.toFixed(2)} {t("common.kg")}
                      </span>
                      <span>
                        {locale === "hi" ? "स्टॉक" : "Stock"}: {stockText}
                      </span>
                      <strong className="text-[var(--ink)] tabular-nums">
                        {formatInr(c.lineTotal, locale)}
                      </strong>
                    </div>
                  ) : null}

                  {billNow && c.product && c.variation && c.qty > 0 ? (
                    <div className="mt-2 grid gap-2 sm:grid-cols-[auto_1fr]">
                      <label className="text-xs font-semibold uppercase tracking-wide text-[var(--ink-muted)]">
                        {locale === "hi" ? "असली वजन (kg)" : "Actual kg"}
                      </label>
                      <NumberField
                        emptyAs={null}
                        step="0.01"
                        className="tt-input tabular-nums"
                        placeholder={c.weightKg.toFixed(2)}
                        value={c.row.actualWeightKg}
                        onValueChange={(v) =>
                          setRow(c.row.id, {
                            actualWeightKg: v === "" ? "" : String(v),
                          })
                        }
                      />
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </section>

        {/* Delivery + notes */}
        <section className="tt-panel p-5">
          <h2 className="font-semibold">
            {locale === "hi" ? "3. डिलीवरी विवरण" : "3. Delivery details"}
          </h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div>
              <label className="tt-label">
                {locale === "hi"
                  ? "पता (डीलर का डिफ़ॉल्ट)"
                  : "Delivery address (defaults to dealer's)"}
              </label>
              <textarea
                className="tt-input"
                rows={2}
                placeholder={dealer?.address || ""}
                value={addressOverride}
                onChange={(e) => setAddressOverride(e.target.value)}
              />
            </div>
            <div>
              <label className="tt-label">
                {locale === "hi" ? "ट्रांसपोर्ट" : "Transport"}
              </label>
              <TransportInput
                placeholder={dealer?.transport || ""}
                value={transportOverride}
                onChange={setTransportOverride}
              />
              <label className="tt-label mt-3">
                {locale === "hi" ? "नोट्स" : "Notes"}
              </label>
              <input
                className="tt-input"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>
          </div>
        </section>

        {/* Totals + wallet + bill */}
        <section className="tt-panel p-5">
          <h2 className="font-semibold">
            {locale === "hi" ? "4. जोड़ + बिलिंग" : "4. Totals & billing"}
          </h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <dl className="space-y-1 text-sm">
              <div className="flex justify-between">
                <dt>{t("checkout.applyWallet")}:</dt>
                <dd>
                  <NumberField
                    className="tt-input w-32 tabular-nums"
                    min={0}
                    max={totals.maxWallet}
                    emptyAs={null}
                    value={walletToUse || ""}
                    onValueChange={(v) =>
                      setWalletToUse(typeof v === "number" ? Math.max(0, v) : 0)
                    }
                    onBlur={() =>
                      setWalletToUse(
                        Math.max(0, Math.min(totals.maxWallet, walletToUse || 0))
                      )
                    }
                    disabled={!dealer || totals.maxWallet <= 0}
                  />
                </dd>
              </div>
              <div className="flex justify-between">
                <dt>{locale === "hi" ? "सबटोटल" : "Subtotal"}</dt>
                <dd className="tabular-nums">
                  {formatInr(totals.subtotal, locale)}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt>{locale === "hi" ? "अनुमानित वजन" : "Est. weight"}</dt>
                <dd className="tabular-nums">
                  {totals.totalWeight.toFixed(2)} {t("common.kg")}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt>{locale === "hi" ? "शिपिंग" : "Shipping"}</dt>
                <dd className="tabular-nums">
                  {formatInr(
                    billNow && billFromKg
                      ? billFromKg.shippingAmount
                      : totals.shipping,
                    locale
                  )}
                </dd>
              </div>
              {(billNow && billFromKg
                ? billFromKg.schemeDiscount
                : totals.schemeDiscount) > 0 ? (
                <div className="flex justify-between text-[var(--ok)]">
                  <dt>
                    {t("common.schemeDiscount")}
                    {totals.schemeLabel ? ` · ${totals.schemeLabel}` : ""}
                  </dt>
                  <dd className="tabular-nums">
                    −
                    {formatInr(
                      billNow && billFromKg
                        ? billFromKg.schemeDiscount
                        : totals.schemeDiscount,
                      locale
                    )}
                  </dd>
                </div>
              ) : null}
              <div className="flex justify-between">
                <dt>{locale === "hi" ? "वॉलेट लगेगा" : "Wallet applied"}</dt>
                <dd className="tabular-nums text-[var(--danger)]">
                  −{formatInr(totals.wallet, locale)}
                </dd>
              </div>
              <div className="flex justify-between border-t border-[var(--line)] pt-1 text-base font-bold">
                <dt>{locale === "hi" ? "अनुमानित कुल" : "Estimated total"}</dt>
                <dd className="tabular-nums">
                  {formatInr(totals.grand, locale)}
                </dd>
              </div>
            </dl>

            <div className="rounded-xl bg-[var(--surface-2)] p-3">
              <label className="flex cursor-pointer items-start gap-2">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={billNow}
                  onChange={(e) => setBillNow(e.target.checked)}
                />
                <span className="text-sm">
                  <strong>
                    {locale === "hi"
                      ? "अभी बिल भी लगा दें"
                      : "Bill this order now"}
                  </strong>
                  <br />
                  <span className="text-xs text-[var(--ink-muted)]">
                    {locale === "hi"
                      ? "वॉक-इन / फ़ोन — असली kg डालें; बिल रेट × kg से अपने आप।"
                      : "Walk-in / phone — enter actual kg; bill is rate × kg automatically."}
                  </span>
                </span>
              </label>

              {billNow ? (
                <div className="mt-3 rounded-lg border border-[var(--line)] bg-white px-3 py-2">
                  <p className="text-[11px] uppercase text-[var(--ink-muted)]">
                    {locale === "hi"
                      ? "अंतिम बिल (kg से)"
                      : "Actual bill (from kg)"}
                  </p>
                  <p className="text-xl font-bold tabular-nums text-[var(--brand-deep)]">
                    {billFromKg
                      ? formatInr(billFromKg.grossBill, locale)
                      : "—"}
                  </p>
                  <p className="text-[11px] text-[var(--ink-muted)]">
                    {billFromKg
                      ? `${billFromKg.totalKg} ${t("common.kg")} · ${
                          locale === "hi" ? "शिपिंग" : "ship"
                        } ${formatInr(billFromKg.shippingAmount, locale)}`
                      : locale === "hi"
                        ? "लाइन में असली kg भरें"
                        : "Fill actual kg on lines above"}
                  </p>
                </div>
              ) : null}
            </div>
          </div>
        </section>

        <div className="flex flex-wrap items-center justify-end gap-2">
          <button
            type="submit"
            className="tt-btn tt-btn-dark"
            disabled={busy || !dealer}
          >
            {busy
              ? locale === "hi"
                ? "बन रहा है…"
                : "Working…"
              : billNow
                ? locale === "hi"
                  ? "ऑर्डर + बिल पंच करें"
                  : "Punch order & bill"
                : locale === "hi"
                  ? "अनुमान बनाएँ"
                  : "Create estimate"}
          </button>
        </div>
      </form>
    </AdminShell>
  );
}
