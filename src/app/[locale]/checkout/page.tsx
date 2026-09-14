"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { TransportInput } from "@/components/TransportInput";
import { NumberField } from "@/components/NumberField";
import { useLocale, useTranslations } from "next-intl";
import { Link, useRouter } from "@/i18n/routing";
import { retryCloudCatalog, useCart, useDb, useSession } from "@/lib/hooks";
import {
  buildOrderLine,
  formatInr,
  roundMoney,
  roundOffRupees,
} from "@/lib/pricing";
import {
  calcShipping,
  canRequestFullTruck,
  countOrderJhals,
  createEstimateOrderAndSync,
  shippingWeightExcludingJhal,
  updateCustomerProfile,
} from "@/lib/store/db";
import {
  lineDiscountedRate,
  lineOrderDiscountTier,
  orderDiscountMathLabel,
  orderDiscountMathQty,
  orderDiscountReceiptLabel,
  previewDealerOrderDiscount,
} from "@/lib/schemes";
import { OrderDiscountExplain } from "@/components/OrderDiscountExplain";

export default function CheckoutPage() {
  const t = useTranslations();
  const locale = useLocale() as "en" | "hi";
  const router = useRouter();
  const { db } = useDb();
  const { session } = useSession();
  const { cart, ready: cartReady } = useCart();

  const user = db?.users.find((u) => u.id === session?.id);

  const [name, setName] = useState("");
  const [gstOrAadhar, setGstOrAadhar] = useState("");
  const [phone, setPhone] = useState("");
  const [transport, setTransport] = useState("");
  const [address, setAddress] = useState("");
  const [pincode, setPincode] = useState("");
  const [notes, setNotes] = useState("");
  const [walletInput, setWalletInput] = useState("");
  const [walletApplied, setWalletApplied] = useState(0);
  const [fullTruck, setFullTruck] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  /** Keep checkout UI stable after cart is cleared on successful place. */
  const [placedOrderId, setPlacedOrderId] = useState<string | null>(null);
  const [checkoutCart, setCheckoutCart] = useState(cart);

  useEffect(() => {
    if (!user) return;
    // Prefill form from persisted profile — intentional sync
    /* eslint-disable react-hooks/set-state-in-effect */
    setName(user.name || "");
    setPhone(user.phone || "");
    setAddress(user.address || "");
    setPincode(user.pincode || "");
    setGstOrAadhar(user.gstOrAadhar || "");
    setTransport(user.transport || "");
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [user]);

  // Mirror cart into local snapshot unless we're submitting / already placed.
  useEffect(() => {
    if (busy || placedOrderId) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCheckoutCart(cart);
  }, [cart, busy, placedOrderId]);

  const lines = useMemo(() => {
    if (!db) return [];
    return checkoutCart
      .map((item) => {
        const product = db.products.find((p) => p.id === item.productId);
        if (!product) return null;
        const variation = product.variations.find((v) => v.id === item.variationId);
        const color = product.colors.find((c) => c.id === item.colorId);
        return {
          key: item.key,
          line: buildOrderLine({
            product,
            variation,
            colorId: color?.id,
            colorName: color?.name,
            quantity: item.quantity,
          }),
        };
      })
      .filter(Boolean) as {
      key: string;
      line: ReturnType<typeof buildOrderLine>;
    }[];
  }, [db, checkoutCart]);

  const subtotal = roundMoney(lines.reduce((s, x) => s + x.line.lineTotal, 0));
  const orderLines = lines.map((x) => x.line);
  const totalWeight = db
    ? shippingWeightExcludingJhal(orderLines, db.products)
    : roundMoney(lines.reduce((s, x) => s + x.line.weightKg, 0));
  const jhalQty = db ? countOrderJhals(orderLines, db.products) : 0;
  const shipping = db ? calcShipping(db, subtotal, totalWeight, jhalQty) : 0;
  const truckOk = db ? canRequestFullTruck(db, subtotal, totalWeight) : false;
  const schemePreview =
    db && user
      ? previewDealerOrderDiscount(
          db.schemes,
          user.assignedSchemeIds,
          orderLines,
          db.products,
          locale
        )
      : { best: null, view: null };
  const schemeBest = schemePreview.best;
  const schemeDiscount = schemeBest?.amount ?? 0;
  const schemeQty =
    schemeBest && db
      ? orderDiscountMathQty(schemeBest.scheme, orderLines, db.products)
      : 0;
  const schemeMath = orderDiscountMathLabel(schemeBest, schemeQty, locale);
  const maxWallet = Math.min(
    user?.walletBalance ?? 0,
    Math.max(0, subtotal + shipping - schemeDiscount)
  );
  const wallet = Math.min(walletApplied, maxWallet);
  // Must match createEstimateOrderAndSync — the payable is rounded to whole
  // rupees there, so showing paise here would quote a different figure.
  const total = roundOffRupees(
    subtotal + shipping - schemeDiscount - wallet
  );

  const applyWallet = () => {
    const amount = Number(walletInput);
    if (Number.isNaN(amount) || amount < 0) {
      setError(locale === "hi" ? "सही वॉलेट राशि डालें" : "Enter a valid wallet amount");
      return;
    }
    setError("");
    setWalletApplied(roundMoney(Math.min(amount, maxWallet)));
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    if (!session) {
      router.push("/");
      return;
    }
    const pin = pincode.replace(/\D/g, "").slice(0, 6);
    if (!name.trim() || !phone.trim() || !address.trim() || pin.length !== 6) {
      setError(
        locale === "hi"
          ? "नाम, नंबर, पता और 6 अंकों का पिनकोड आवश्यक हैं"
          : "Name, phone, address and 6-digit pincode are required"
      );
      return;
    }
    if (!checkoutCart.length) {
      setError(
        locale === "hi" ? "आपकी कार्ट खाली है।" : "Your cart is empty."
      );
      return;
    }
    setBusy(true);
    try {
      const order = await createEstimateOrderAndSync({
        userId: session.id,
        cart: checkoutCart,
        deliveryAddress: `${address.trim()} — PIN ${pin}`,
        customerNotes: notes,
        checkoutName: name.trim(),
        gstOrAadhar: gstOrAadhar.trim(),
        phone: phone.trim(),
        transport: transport.trim(),
        walletToUse: wallet,
        fullTruckRequested: fullTruck && truckOk,
        locale,
      });
      try {
        updateCustomerProfile(session.id, {
          name: name.trim(),
          phone: phone.trim(),
          address: address.trim(),
          pincode: pin,
          gstOrAadhar: gstOrAadhar.trim(),
          transport: transport.trim(),
        });
      } catch {
        /* order already placed */
      }
      setPlacedOrderId(order.id);
      router.replace(`/orders/${order.id}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed";
      setError(msg);
      if (/stock|available/i.test(msg)) {
        void retryCloudCatalog();
      }
      setBusy(false);
    }
  };

  if (!db || !cartReady) {
    return <p className="tt-section tt-wrap">{t("common.loading")}</p>;
  }
  if (!session) {
    return (
      <section className="tt-section">
        <div className="tt-wrap">
          <p>
            {locale === "hi" ? "चेकआउट के लिए लॉगिन करें।" : "Please login to checkout."}{" "}
            <Link href="/" className="font-semibold text-[var(--brand)]">
              {t("nav.login")}
            </Link>
          </p>
        </div>
      </section>
    );
  }

  if (placedOrderId || busy) {
    return (
      <section className="tt-section">
        <div className="tt-wrap">
          <p className="text-[var(--ink-muted)]">
            {locale === "hi"
              ? "ऑर्डर सेव हो रहा है…"
              : "Saving your order…"}
          </p>
        </div>
      </section>
    );
  }

  if (!checkoutCart.length) {
    return (
      <section className="tt-section">
        <div className="tt-wrap tt-panel max-w-lg p-6">
          <h1 className="text-2xl font-semibold">{t("common.estimate")}</h1>
          <p className="mt-3 text-[var(--ink-muted)]">{t("common.emptyCart")}</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Link href="/quick-order" className="tt-btn tt-btn-outline">
              {t("nav.quickOrder")}
            </Link>
            <Link href="/catalog" className="tt-btn tt-btn-dark">
              {t("common.continueShopping")}
            </Link>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="tt-section">
      <div className="tt-wrap grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
        <aside className="tt-panel order-1 h-fit p-5 lg:order-2">
          <h2 className="font-semibold">
            {t("shop.checkoutSummary")}
          </h2>
          {checkoutCart.length ? (
            <Link
              href="/quick-order"
              className="mt-1 inline-block text-sm font-semibold text-[var(--brand)] hover:underline"
            >
              {t("checkout.editCart")}
            </Link>
          ) : null}
          <ul className="mt-4 space-y-3 text-sm">
            {lines.map(({ key, line: l }) => {
              const size =
                l.size?.[locale] || l.variationLabel?.[locale] || "";
              const color = l.colorName?.[locale] || "";
              const product = db.products.find((p) => p.id === l.productId);
              const lineTier = lineOrderDiscountTier(schemeBest, l);
              const rates =
                lineTier && product
                  ? lineDiscountedRate(
                      schemeBest!.scheme,
                      lineTier,
                      l,
                      product
                    )
                  : null;
              const meta = [size, color].filter(Boolean).join(" · ");
              return (
                <li key={key} className="flex justify-between gap-3">
                  <span className="min-w-0">
                    <span className="block break-words">
                      {l.productName[locale]} × {l.quantity}
                    </span>
                    {meta ? (
                      <span className="block text-xs text-[var(--ink-muted)]">
                        {meta}
                      </span>
                    ) : null}
                    {rates && rates.discountedRate < rates.listRate ? (
                      <span className="block text-xs text-[var(--ok)]">
                        <span className="text-[var(--ink-muted)] line-through">
                          {formatInr(rates.listRate, locale)}
                          {product?.pricingMode === "pcs"
                            ? locale === "hi"
                              ? "/पीस"
                              : "/pc"
                            : locale === "hi"
                              ? "/किग्रा"
                              : "/kg"}
                        </span>
                        {" → "}
                        {formatInr(rates.discountedRate, locale)}
                        {product?.pricingMode === "pcs"
                          ? locale === "hi"
                            ? "/पीस"
                            : "/pc"
                          : locale === "hi"
                            ? "/किग्रा"
                            : "/kg"}
                        {locale === "hi"
                          ? " · अनुमान"
                          : " · estimate"}
                      </span>
                    ) : null}
                  </span>
                  <span className="shrink-0 tabular-nums">
                    {formatInr(l.lineTotal, locale)}
                  </span>
                </li>
              );
            })}
          </ul>
          <div className="mt-6 space-y-2 border-t border-[var(--line)] pt-4 text-sm">
            <div className="tt-kv-row">
              <span>{t("common.subtotal")}</span>
              <span className="tabular-nums">{formatInr(subtotal, locale)}</span>
            </div>
            <div className="tt-kv-row">
              <span>{t("common.shipping")}</span>
              <span className="tabular-nums">{formatInr(shipping, locale)}</span>
            </div>
            {schemeDiscount > 0 ? (
              <div className="tt-kv-row text-[var(--ok)]">
                <span>
                  {t("schemes.orderDiscountEstimate")}
                  {schemeMath ? ` · ${schemeMath}` : schemeBest
                    ? ` · ${orderDiscountReceiptLabel(schemeBest, locale)}`
                    : ""}
                  <span className="mt-0.5 block text-[11px] font-normal text-[var(--ink-muted)]">
                    {t("schemes.orderDiscountAfterWeight")}
                  </span>
                </span>
                <span className="tabular-nums">
                  -{formatInr(schemeDiscount, locale)}
                </span>
              </div>
            ) : null}
            {schemePreview.view ? (
              <div className="rounded-xl border border-[var(--line)] bg-[var(--surface)] p-3">
                <p className="text-xs font-bold uppercase tracking-wide text-[var(--brand)]">
                  {t("schemes.orderDiscount")}
                </p>
                <div className="mt-2">
                  <OrderDiscountExplain view={schemePreview.view} compact />
                </div>
              </div>
            ) : null}
            <div className="tt-kv-row">
              <span>{t("common.wallet")}</span>
              <span className="tabular-nums">-{formatInr(wallet, locale)}</span>
            </div>
            <div className="tt-kv-row text-base font-bold">
              <span>{t("common.total")}</span>
              <span className="tabular-nums">{formatInr(total, locale)}</span>
            </div>
          </div>
        </aside>

        <div className="tt-panel order-2 p-4 sm:p-5 lg:order-1">
          <h1 className="text-2xl font-semibold">
            {t("common.estimate")} / {t("common.buyNow")}
          </h1>
          <p className="mt-2 text-sm text-[var(--ink-muted)]">
            {locale === "hi"
              ? "आपकी प्रोफ़ाइल से विवरण अपने आप भरे गए हैं।"
              : "Details are auto-filled from your profile."}
          </p>
          <form className="mt-6 grid gap-4 sm:grid-cols-2" onSubmit={onSubmit}>
            <div>
              <label className="tt-label">{t("auth.name")} *</label>
              <input
                className="tt-input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </div>
            <div>
              <label className="tt-label">{t("checkout.gstAadhar")}</label>
              <input
                className="tt-input"
                value={gstOrAadhar}
                onChange={(e) => setGstOrAadhar(e.target.value)}
                placeholder={t("checkout.gstPlaceholder")}
              />
            </div>
            <div>
              <label className="tt-label">{t("checkout.phone")} *</label>
              <input
                className="tt-input"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                required
              />
            </div>
            <div>
              <label className="tt-label">{t("checkout.transport")}</label>
              <TransportInput
                value={transport}
                onChange={setTransport}
                placeholder={
                  locale === "hi" ? "ट्रांसपोर्ट नाम / मोड" : "Transport name / mode"
                }
              />
            </div>
            <div className="sm:col-span-2">
              <label className="tt-label">{t("auth.address")} *</label>
              <textarea
                className="tt-textarea"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                required
              />
            </div>
            <div>
              <label className="tt-label">{t("auth.pincode")} *</label>
              <input
                className="tt-input"
                type="tel"
                inputMode="numeric"
                maxLength={6}
                placeholder={t("auth.pincodePlaceholder")}
                value={pincode}
                onChange={(e) =>
                  setPincode(e.target.value.replace(/\D/g, "").slice(0, 6))
                }
                required
              />
            </div>
            <div className="sm:col-span-2">
              <label className="tt-label">{t("checkout.notes")}</label>
              <textarea
                className="tt-textarea"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>

            <div className="sm:col-span-2 rounded-xl border border-[var(--line)] bg-[var(--surface)] p-4">
              <label className="tt-label">
                {t("common.wallet")} —{" "}
                {formatInr(user?.walletBalance ?? 0, locale)}{" "}
                {locale === "hi" ? "उपलब्ध" : "available"}
              </label>
              <div className="mt-1 flex flex-wrap gap-2">
                <NumberField
                  min={0}
                  max={maxWallet}
                  step={1}
                  emptyAs={null}
                  className="tt-input max-w-[200px]"
                  value={walletInput}
                  onValueChange={(v) =>
                    setWalletInput(v === "" ? "" : String(v))
                  }
                  placeholder="0"
                />
                <button
                  type="button"
                  className="tt-btn tt-btn-outline"
                  onClick={applyWallet}
                >
                  {t("checkout.applyWallet")}
                </button>
                {maxWallet > 0 ? (
                  <button
                    type="button"
                    className="tt-btn tt-btn-dark"
                    onClick={() => {
                      setError("");
                      setWalletApplied(maxWallet);
                      setWalletInput(String(maxWallet));
                    }}
                  >
                    {t("checkout.useFullWallet")}
                  </button>
                ) : null}
                {walletApplied > 0 ? (
                  <button
                    type="button"
                    className="tt-btn tt-btn-outline"
                    onClick={() => {
                      setWalletApplied(0);
                      setWalletInput("");
                    }}
                  >
                    {t("checkout.clearWallet")}
                  </button>
                ) : null}
              </div>
              {walletApplied > 0 ? (
                <p className="mt-2 text-sm text-[var(--brand-deep)]">
                  {locale === "hi" ? "लागू:" : "Applied:"}{" "}
                  {formatInr(wallet, locale)}
                </p>
              ) : null}
            </div>

            {truckOk ? (
              <label className="sm:col-span-2 flex min-h-11 items-start gap-3 rounded-xl border border-[var(--line)] bg-[var(--surface)] p-3">
                <input
                  type="checkbox"
                  className="mt-1 h-5 w-5 shrink-0 accent-[var(--brand)]"
                  checked={fullTruck}
                  onChange={(e) => setFullTruck(e.target.checked)}
                />
                <span>
                  <span className="font-semibold">{t("common.fullTruck")}</span>
                  <span className="block text-sm text-[var(--ink-muted)]">
                    {t("common.fullTruckHint")} (
                    {db.settings.fullTruckMinWeightKg} kg /{" "}
                    {formatInr(db.settings.fullTruckMinValue, locale)})
                  </span>
                </span>
              </label>
            ) : null}

            {error ? (
              <p className="sm:col-span-2 text-sm text-[var(--danger)]">{error}</p>
            ) : null}
            <div className="tt-sticky-bar sm:col-span-2 sm:static sm:mt-2 sm:border-0 sm:bg-transparent sm:p-0 sm:shadow-none">
              <div className="mb-2 flex items-center justify-between gap-3 sm:hidden">
                <span className="text-sm text-[var(--ink-muted)]">
                  {t("common.total")}
                </span>
                <span className="text-lg font-bold tabular-nums">
                  {formatInr(total, locale)}
                </span>
              </div>
              <button
                type="submit"
                className="tt-btn tt-btn-dark w-full"
                disabled={busy || !checkoutCart.length}
              >
                {t("common.placeEstimate")}
              </button>
            </div>
          </form>
        </div>
      </div>
    </section>
  );
}
