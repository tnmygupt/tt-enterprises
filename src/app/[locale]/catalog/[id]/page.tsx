"use client";

import { useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useParams } from "next/navigation";
import { useRouter } from "@/i18n/routing";
import { NumberField } from "@/components/NumberField";
import { sanitizeHtml, hasRichContent } from "@/components/RichTextEditor";
import { isRawMaterial } from "@/lib/catalog-visibility";
import { categoryLabel } from "@/lib/categories";
import { useDb, useSession } from "@/lib/hooks";
import {
  firstInStockColorId,
  firstInStockSelection,
  getSizeColorStock,
} from "@/lib/inventory";
import { loc } from "@/lib/localized";
import {
  calcLineTotal,
  formatInr,
  isPackCountUnit,
  isSqftUnit,
  pcsPerPacketLabel,
  ratePerPacket,
  ratePerPiece,
  resolvePcsPerPacket,
  resolveRate,
  resolveSqftPack,
  resolveUnitWeightKg,
  resolveWeightKg,
  roundMoney,
  sqftPerPiece,
  unitLabel,
  variationDisplayLabel,
} from "@/lib/pricing";
import { getCart, saveCart } from "@/lib/store/db";

export default function ProductDetailPage() {
  const t = useTranslations();
  const locale = useLocale() as "en" | "hi";
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { db } = useDb();
  const { session, ready } = useSession();
  const loggedIn = ready && !!session;
  const product = db?.products.find(
    (p) => p.id === params.id && !isRawMaterial(p)
  );

  const [variationId, setVariationId] = useState<string>("");
  const [colorId, setColorId] = useState<string>("");
  const [quantity, setQuantity] = useState(1);
  const [added, setAdded] = useState(false);
  const [activeMediaId, setActiveMediaId] = useState<string>("");

  useEffect(() => {
    if (!product) return;
    // Initialise selections when the product loads. Intentional derived-state sync.
    /* eslint-disable react-hooks/set-state-in-effect */
    const variations = product.variations ?? [];
    const colors = product.colors ?? [];
    const media = product.media ?? [];
    const galleryIds = [
      ...media.filter((m) => m.url).map((m) => m.id),
      ...(product.logoUrl && !media.some((m) => m.url === product.logoUrl)
        ? [`${product.id}_logo`]
        : []),
    ];
    const pick = firstInStockSelection(product);
    setVariationId((prev) => {
      if (prev && variations.some((v) => v.id === prev)) return prev;
      return pick.variationId;
    });
    setColorId((prev) => {
      if (prev && colors.some((c) => c.id === prev)) {
        const keepStock = getSizeColorStock(product, pick.variationId || prev, prev);
        if (keepStock > 0) return prev;
      }
      return pick.colorId;
    });
    setActiveMediaId((prev) => {
      if (prev && galleryIds.includes(prev)) return prev;
      return (
        media.find((m) => m.url)?.id ??
        (product.logoUrl ? `${product.id}_logo` : "")
      );
    });
    const firstStock = getSizeColorStock(
      product,
      pick.variationId,
      pick.colorId || undefined
    );
    const lo = Math.min(product.minOrderQty ?? 1, firstStock || 0);
    setQuantity(firstStock > 0 ? Math.max(lo || 1, 1) : 0);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [product?.id]); // eslint-disable-line react-hooks/exhaustive-deps -- init when product loads

  const variation = useMemo(() => {
    if (!product) return undefined;
    const variations = product.variations ?? [];
    return variations.find((v) => v.id === variationId) ?? variations[0];
  }, [product, variationId]);

  const color = useMemo(() => {
    if (!product) return undefined;
    const colors = product.colors ?? [];
    return colors.find((c) => c.id === colorId) ?? colors[0];
  }, [product, colorId]);

  useEffect(() => {
    if (!product || !variation) return;
    // Clamp quantity to current stock — intentional derived-state sync.
    /* eslint-disable react-hooks/set-state-in-effect */
    const stock = getSizeColorStock(product, variation.id, color?.id);
    if (stock <= 0) {
      setQuantity(0);
      return;
    }
    setQuantity((q) => {
      const lo = Math.min(product.minOrderQty ?? 1, stock);
      return Math.min(stock, Math.max(lo || 1, q || lo));
    });
    /* eslint-enable react-hooks/set-state-in-effect */
    // eslint-disable-next-line react-hooks/exhaustive-deps -- variation is derived from variation?.id
  }, [product, variation?.id, color?.id]);

  if (!db) {
    return <p className="tt-section tt-wrap">{t("common.loading")}</p>;
  }
  if (!product) {
    return <p className="tt-section tt-wrap">{t("common.empty")}</p>;
  }

  const productTitle = loc(product.name, locale, product.code || "Product");
  const productItem = loc(product.itemName, locale);
  const productDesc = loc(product.description, locale);
  const htmlDesc =
    product.descriptionHtml?.[locale] || product.descriptionHtml?.en || "";
  const showHtmlDesc = hasRichContent(htmlDesc);
  const showPlainDesc = !showHtmlDesc && Boolean(productDesc.trim());
  const brandName = (product.brand || "").trim();
  const variations = product.variations ?? [];
  const colors = product.colors ?? [];
  const media = product.media ?? [];
  // Prefer gallery media; fall back to brand logo so the product page never
  // looks empty when only logoUrl was uploaded.
  const gallery = (() => {
    const fromMedia = media.filter((m) => m.url);
    if (fromMedia.length) return fromMedia;
    if (product.logoUrl) {
      return [
        {
          id: `${product.id}_logo`,
          type: "image" as const,
          url: product.logoUrl,
        },
      ];
    }
    return [];
  })();

  const stockBundles = getSizeColorStock(product, variation?.id, color?.id);
  const outOfStock = stockBundles <= 0;
  const minQty = Math.min(product.minOrderQty ?? 1, stockBundles || 0);
  const qty =
    stockBundles <= 0
      ? 0
      : Math.min(stockBundles, Math.max(minQty || 1, quantity));
  const rate = resolveRate(product, variation);
  const w = qty > 0 ? resolveWeightKg(product, variation, qty) : 0;
  const lineTotal =
    qty > 0
      ? calcLineTotal({
          pricingMode: product.pricingMode,
          rate,
          quantity: qty,
          weightKg: w,
        })
      : 0;

  const addToCart = () => {
    if (!loggedIn) {
      router.push("/");
      return;
    }
    if (!variation && variations.length) return;
    if (qty <= 0 || stockBundles <= 0) return;
    const cart = getCart();
    const key = `${product.id}:${variation?.id ?? ""}:${color?.id ?? ""}`;
    const existing = cart.find((c) => c.key === key);
    const alreadySameSku = cart
      .filter(
        (c) =>
          c.productId === product.id &&
          (c.variationId || "") === (variation?.id || "") &&
          (c.colorId || "") === (color?.id || "")
      )
      .reduce((s, c) => s + c.quantity, 0);
    const room = Math.max(0, stockBundles - alreadySameSku);
    if (room <= 0) return;
    const addQty = Math.min(qty, room);
    if (existing) {
      existing.quantity += addQty;
      existing.weightKg = resolveWeightKg(
        product,
        variation,
        existing.quantity
      );
    } else {
      cart.push({
        key,
        productId: product.id,
        variationId: variation?.id,
        colorId: color?.id,
        quantity: addQty,
        weightKg: resolveWeightKg(product, variation, addQty),
      });
    }
    saveCart(cart);
    setAdded(true);
    window.setTimeout(() => setAdded(false), 1600);
  };

  return (
    <section className="tt-section">
      <div className="tt-wrap grid gap-10 lg:grid-cols-2">
        <div>
          {(() => {
            const active =
              gallery.find((m) => m.id === activeMediaId) ?? gallery[0];
            return (
              <>
                <div className="overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--surface-2)]">
                  {active?.type === "video" ? (
                    <video
                      key={active.id}
                      controls
                      playsInline
                      className="mx-auto max-h-[70vh] w-full bg-black object-contain"
                      src={active.url}
                    />
                  ) : active?.url ? (
                    // Natural aspect ratio of the uploaded image (no forced crop).
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      key={active.id}
                      src={active.url}
                      alt={productTitle}
                      className="mx-auto max-h-[70vh] w-full object-contain"
                    />
                  ) : (
                    <div
                      className="flex min-h-[220px] items-center justify-center bg-[var(--surface-2)] text-sm text-[var(--ink-muted)]"
                      role="img"
                      aria-label={productTitle}
                    >
                      {t("shop.noImage")}
                    </div>
                  )}
                </div>
                {gallery.length > 1 ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {gallery.map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => setActiveMediaId(m.id)}
                        className={`relative h-16 w-20 overflow-hidden rounded-lg border-2 ${
                          active?.id === m.id
                            ? "border-[var(--brand-deep)]"
                            : "border-[var(--line)]"
                        }`}
                        aria-label={
                          m.type === "video"
                            ? locale === "hi"
                              ? "वीडियो"
                              : "Video"
                            : locale === "hi"
                              ? "फोटो"
                              : "Photo"
                        }
                      >
                        {m.type === "video" ? (
                          <>
                            <video
                              src={m.url}
                              muted
                              playsInline
                              className="h-full w-full object-cover"
                            />
                            <span className="absolute inset-x-0 bottom-0 bg-black/60 py-0.5 text-center text-[10px] font-bold text-white">
                              VIDEO
                            </span>
                          </>
                        ) : (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={m.url}
                            alt=""
                            className="h-full w-full object-cover"
                          />
                        )}
                      </button>
                    ))}
                  </div>
                ) : null}
              </>
            );
          })()}
        </div>

        <div>
          <div className="flex flex-wrap items-center gap-3">
            {product.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={product.logoUrl}
                alt={brandName || productTitle}
                className="tt-logo shrink-0"
              />
            ) : null}
            <div className="min-w-0">
              {brandName ? (
                <p className="text-sm font-bold uppercase tracking-wider text-[var(--brand)]">
                  {t("shop.brand")}: {brandName}
                </p>
              ) : null}
              <p className="text-xs font-bold uppercase tracking-wider text-[var(--ink-muted)]">
                {categoryLabel(db.categories, product.category, locale)}
                {product.code ? ` · ${product.code}` : ""}
                {productItem && productItem !== productTitle
                  ? ` · ${productItem}`
                  : ""}
              </p>
            </div>
          </div>
          <h1 className="tt-display mt-2 break-words text-2xl text-[var(--brand-deep)] sm:text-4xl">
            {productTitle}
          </h1>
          {(product.material || product.gsm || product.thicknessMm) && (
            <p className="mt-2 text-sm text-[var(--ink-muted)]">
              {[
                product.material,
                product.gsm != null ? `${product.gsm} GSM` : "",
                product.thicknessMm != null
                  ? `${product.thicknessMm} mm`
                  : "",
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          )}
          {showHtmlDesc ? (
            <div
              className="tt-prose mt-4 rounded-xl border border-[var(--line)] bg-[var(--surface-2)] p-4 text-[var(--ink)]"
              dangerouslySetInnerHTML={{
                __html: sanitizeHtml(htmlDesc),
              }}
            />
          ) : showPlainDesc ? (
            <p className="mt-4 whitespace-pre-wrap rounded-xl border border-[var(--line)] bg-[var(--surface-2)] p-4 text-[var(--ink)]">
              {productDesc}
            </p>
          ) : null}

          <p className="mt-4 text-2xl font-semibold">
            {loggedIn
              ? isSqftUnit(product.unit)
                ? formatInr(resolveSqftPack(product, variation).ratePerSqft, locale)
                : formatInr(rate, locale)
              : locale === "hi"
                ? "रेट के लिए लॉगिन करें"
                : "Login to see rates"}
            {loggedIn ? (
              <span className="text-base font-normal text-[var(--ink-muted)]">
                {" "}
                /{" "}
                {product.pricingMode === "bundle"
                  ? t("common.kg")
                  : unitLabel(product.unit, locale)}
              </span>
            ) : null}
          </p>
          {loggedIn && isSqftUnit(product.unit) ? (
            <p className="mt-1 text-sm text-[var(--ink-muted)]">
              {(() => {
                const spec = resolveSqftPack(product, variation);
                const pc = ratePerPiece(
                  spec.ratePerSqft,
                  spec.lengthFt,
                  spec.widthFt
                );
                const pkt = ratePerPacket(
                  spec.ratePerSqft,
                  spec.lengthFt,
                  spec.widthFt,
                  spec.pcsPerPacket
                );
                const sqft = sqftPerPiece(spec.lengthFt, spec.widthFt);
                const pcs = spec.pcsPerPacket;
                const pcsBit = pcs > 0 ? ` · ${pcsPerPacketLabel(pcs, locale)}` : "";
                return `${sqft} sqft/pc${pcsBit} · ${formatInr(pc, locale)}/pc · ${formatInr(pkt, locale)}/pkt`;
              })()}
            </p>
          ) : null}
          {(() => {
            const pcs = resolvePcsPerPacket(product, variation);
            if (!(pcs > 0)) return null;
            const shipKg = isPackCountUnit(product.unit)
              ? resolveUnitWeightKg(product, variation)
              : 0;
            return (
              <p className="mt-3 rounded-xl border border-[var(--brand)] bg-[var(--surface-2)] px-3 py-2 text-lg font-bold text-[var(--brand-deep)]">
                {t("shop.pcsInPacket", { n: pcs })}
                {shipKg > 0
                  ? ` · ${t("shop.kgPerPkt", { kg: roundMoney(shipKg) })}`
                  : ""}
              </p>
            );
          })()}
          <p className="mt-1 text-sm text-[var(--ink-muted)]">
            {product.pricingMode === "bundle"
              ? t("common.bundleHint")
              : isSqftUnit(product.unit)
                ? locale === "hi"
                  ? "पैकेट रेट × मात्रा (पैकेट)"
                  : "Packet price = ₹/pkt × packets"
              : locale === "hi"
                ? "पीस रेट × मात्रा"
                : "Piece price = rate × quantity"}
          </p>
          <p className="mt-1 text-sm text-[var(--ink-muted)]">
            {t("shop.stock")}:{" "}
            <strong
              className={outOfStock ? "text-[var(--danger)]" : "text-[var(--ink)]"}
            >
              {outOfStock
                ? locale === "hi"
                  ? "खत्म"
                  : "Out of stock"
                : `${stockBundles} ${locale === "hi" ? "बंडल" : "bundles"}`}
            </strong>
          </p>

          {variations.length ? (
            <div className="mt-6">
              <label className="tt-label">{t("common.variation")}</label>
              <div className="flex flex-wrap gap-2">
                {variations.map((v) => {
                  const selected = (variation?.id ?? "") === v.id;
                  const vStock = getSizeColorStock(
                    product,
                    v.id,
                    color?.id
                  );
                  return (
                    <button
                      key={v.id}
                      type="button"
                      onClick={() => {
                        setVariationId(v.id);
                        if (product) {
                          const nextColor = firstInStockColorId(product, v.id);
                          if (nextColor) setColorId(nextColor);
                        }
                      }}
                      className={`rounded-lg border px-3 py-2 text-left text-sm ${
                        selected
                          ? "tt-selected border-[var(--brand)] bg-[var(--brand-deep)] text-white"
                          : "border-[var(--line)] bg-white"
                      }`}
                    >
                      <span className="block font-semibold">
                        {loc(v.size, locale) || loc(v.label, locale)}
                      </span>
                      {(() => {
                        const pcsLbl = pcsPerPacketLabel(
                          resolvePcsPerPacket(product, v),
                          locale
                        );
                        if (!pcsLbl) return null;
                        return (
                          <span
                            className={`block text-sm font-bold tabular-nums ${
                              selected ? "text-white" : "text-[var(--brand)]"
                            }`}
                          >
                            {pcsLbl}
                          </span>
                        );
                      })()}
                      <span
                        className={`block text-xs ${
                          selected ? "text-white/80" : "text-[var(--ink-muted)]"
                        }`}
                      >
                        {loggedIn
                          ? `${formatInr(v.rate, locale)} · `
                          : ""}
                        {`${vStock} ${locale === "hi" ? "बंडल" : "bdl"}`}
                      </span>
                    </button>
                  );
                })}
              </div>
              {variation ? (
                <p className="mt-2 text-xs text-[var(--ink-muted)]">
                  {variationDisplayLabel(variation, locale)}
                  {variation.sku ? ` · SKU ${variation.sku}` : ""}
                </p>
              ) : null}
            </div>
          ) : null}

          {colors.length ? (
            <div className="mt-6">
              <label className="tt-label">{t("common.color")}</label>
              <div className="flex flex-wrap gap-2">
                {colors.map((c, colorIdx) => {
                  const cStock = getSizeColorStock(
                    product,
                    variation?.id,
                    c.id
                  );
                  const colorName = loc(
                    c.name,
                    locale,
                    `Color ${colorIdx + 1}`
                  );
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => setColorId(c.id)}
                      disabled={cStock <= 0}
                      className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm disabled:opacity-40 ${
                        (color?.id ?? "") === c.id
                          ? "border-[var(--brand)]"
                          : "border-[var(--line)]"
                      }`}
                    >
                      <span
                        className="h-6 w-6 overflow-hidden rounded-full border border-[var(--line)]"
                        style={
                          c.imageUrl
                            ? undefined
                            : { background: c.hex }
                        }
                      >
                        {c.imageUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={c.imageUrl}
                            alt=""
                            className="h-full w-full object-cover"
                          />
                        ) : null}
                      </span>
                      {colorName}
                      <span className="text-xs text-[var(--ink-muted)]">
                        {cStock}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}

          <div className="mt-6 max-w-xs">
            <label className="tt-label">
              {product.pricingMode === "bundle"
                ? locale === "hi"
                  ? "बंडल"
                  : "Bundles"
                : t("common.quantity")}
            </label>
            <NumberField
              integer
              min={
                stockBundles > 0
                  ? Math.min(product.minOrderQty ?? 1, stockBundles)
                  : 0
              }
              max={stockBundles}
              disabled={outOfStock}
              className="tt-input"
              value={outOfStock ? 0 : quantity}
              emptyAs={null}
              onValueChange={(v) => {
                if (outOfStock || stockBundles <= 0) {
                  setQuantity(0);
                  return;
                }
                if (v === "") return;
                setQuantity(v);
              }}
              onBlur={() => {
                if (outOfStock || stockBundles <= 0) {
                  setQuantity(0);
                  return;
                }
                const lo = Math.min(product.minOrderQty ?? 1, stockBundles);
                setQuantity((q) =>
                  Math.min(stockBundles, Math.max(lo, q || lo))
                );
              }}
            />
            {!outOfStock ? (
              <p className="mt-1 text-xs text-[var(--ink-muted)]">
                {locale === "hi"
                  ? `अधिकतम ${stockBundles} बंडल`
                  : `Max ${stockBundles} bundles`}
              </p>
            ) : null}
          </div>

          <div className="mt-6 rounded-2xl bg-[var(--surface-2)] p-4">
            <div className="flex justify-between text-sm text-[var(--ink-muted)]">
              {loggedIn ? (
                <>
                  <span>
                    {product.pricingMode === "bundle"
                      ? `${formatInr(rate, locale)}/${t("common.kg")} × ${qty} ${locale === "hi" ? "बंडल" : "bundles"}`
                      : isSqftUnit(product.unit)
                        ? `${formatInr(rate, locale)}/pkt × ${qty}`
                        : `${formatInr(rate, locale)} × ${qty}`}
                  </span>
                  <span>
                    {t("common.total")}:{" "}
                    <strong className="text-[var(--ink)]">
                      {formatInr(lineTotal, locale)}
                    </strong>
                  </span>
                </>
              ) : (
                <span>
                  {locale === "hi"
                    ? "ऑर्डर करने के लिए लॉगिन करें"
                    : "Log in to order"}
                </span>
              )}
            </div>
          </div>

          {added ? (
            <p className="mt-3 text-sm text-[var(--ok)]">
              {t("shop.addedToCart")}
            </p>
          ) : null}

          <div className="mt-6 hidden sm:block">
            <button
              type="button"
              className="tt-btn tt-btn-dark w-full max-w-xs"
              disabled={loggedIn ? outOfStock : false}
              onClick={() => {
                if (!loggedIn) {
                  router.push("/");
                  return;
                }
                addToCart();
                router.push("/quick-order");
              }}
            >
              {!loggedIn
                ? t("nav.login")
                : locale === "hi"
                  ? "क्विक ऑर्डर पर जाएँ"
                  : "Go to Quick Order"}
            </button>
          </div>
        </div>
      </div>

      <div className="tt-sticky-bar sm:hidden">
        <button
          type="button"
          className="tt-btn tt-btn-dark w-full"
          disabled={loggedIn ? outOfStock : false}
          onClick={() => {
            if (!loggedIn) {
              router.push("/");
              return;
            }
            addToCart();
            router.push("/quick-order");
          }}
        >
          {!loggedIn
            ? t("nav.login")
            : outOfStock
              ? locale === "hi"
                ? "स्टॉक खत्म"
                : "Out of stock"
              : locale === "hi"
                ? "क्विक ऑर्डर"
                : "Quick Order"}
        </button>
      </div>
    </section>
  );
}
