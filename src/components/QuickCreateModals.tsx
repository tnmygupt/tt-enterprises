"use client";

import { FormEvent, useMemo, useState } from "react";
import { NumberField } from "@/components/NumberField";
import { useDb } from "@/lib/hooks";
import {
  applySqftComputedRate,
  formatInr,
  isPackCountUnit,
  isSqftUnit,
  ratePerPacket,
  ratePerPiece,
  sqftSizeLabel,
} from "@/lib/pricing";
import { upsertParty, upsertProduct } from "@/lib/store/db";
import type {
  Party,
  PartyType,
  Product,
  ProductVariation,
  UnitOfSale,
} from "@/lib/types";

function ModalShell({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="tt-panel max-h-[85dvh] w-full max-w-lg overflow-y-auto p-5 shadow-xl">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-[var(--brand-deep)]">
            {title}
          </h2>
          <button
            type="button"
            className="tt-btn tt-btn-outline"
            onClick={onClose}
          >
            Close
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

type CreatePartyModalProps = {
  defaultType?: PartyType;
  onClose: () => void;
  onCreated: (party: Party) => void;
};

export function CreatePartyModal({
  defaultType = "customer",
  onClose,
  onCreated,
}: CreatePartyModalProps) {
  const { refresh } = useDb();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [type, setType] = useState<PartyType>(defaultType);
  const [address, setAddress] = useState("");
  const [gstin, setGstin] = useState("");
  const [error, setError] = useState("");

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    setError("");
    if (!name.trim()) {
      setError("Name is required");
      return;
    }
    const party: Party = {
      id: `party_${crypto.randomUUID()}`,
      name: name.trim(),
      phone: phone.trim(),
      type,
      openingBalance: 0,
      address: address.trim(),
      pincode: "",
      gstin: gstin.trim(),
      creditLimit: 0,
      active: true,
      createdAt: new Date().toISOString(),
    };
    upsertParty(party);
    refresh();
    onCreated(party);
    onClose();
  };

  return (
    <ModalShell title="New party" onClose={onClose}>
      <form onSubmit={onSubmit} className="space-y-3">
        <div>
          <label className="tt-label">Name</label>
          <input
            className="tt-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            autoFocus
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="tt-label">Type</label>
            <select
              className="tt-select"
              value={type}
              onChange={(e) => setType(e.target.value as PartyType)}
            >
              <option value="customer">Customer</option>
              <option value="supplier">Supplier</option>
            </select>
          </div>
          <div>
            <label className="tt-label">Phone</label>
            <input
              className="tt-input"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
          </div>
        </div>
        <div>
          <label className="tt-label">Address</label>
          <input
            className="tt-input"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
          />
        </div>
        <div>
          <label className="tt-label">ID / Aadhaar</label>
          <input
            className="tt-input"
            value={gstin}
            onChange={(e) => setGstin(e.target.value)}
          />
        </div>
        {error ? <p className="text-sm text-[var(--danger)]">{error}</p> : null}
        <button type="submit" className="tt-btn tt-btn-dark">
          Save party
        </button>
      </form>
    </ModalShell>
  );
}

type CreateProductModalProps = {
  onClose: () => void;
  onCreated: (product: Product, variationId: string) => void;
};

export function CreateProductModal({
  onClose,
  onCreated,
}: CreateProductModalProps) {
  const { db, refresh } = useDb();
  const categories = useMemo(
    () => db?.categories.filter((c) => c.active) ?? [],
    [db]
  );
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [category, setCategory] = useState(
    () => categories[0]?.id || "tarpaulin"
  );
  const [unit, setUnit] = useState<UnitOfSale>("kg");
  const [size, setSize] = useState("");
  const [rate, setRate] = useState<number | "">(0);
  const [weightKg, setWeightKg] = useState<number | "">(1);
  const [lengthFt, setLengthFt] = useState<number | "">("");
  const [widthFt, setWidthFt] = useState<number | "">("");
  const [pcsPerPacket, setPcsPerPacket] = useState<number | "">("");
  const [error, setError] = useState("");

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    setError("");
    if (!name.trim()) {
      setError("Item name is required");
      return;
    }
    const now = new Date().toISOString();
    const rateN = typeof rate === "number" ? rate : 0;
    const wt = typeof weightKg === "number" ? weightKg : 1;
    const lFt = typeof lengthFt === "number" ? lengthFt : 0;
    const wFt = typeof widthFt === "number" ? widthFt : 0;
    const pcs = typeof pcsPerPacket === "number" ? pcsPerPacket : 0;
    if (isSqftUnit(unit)) {
      if (!(lFt > 0) || !(wFt > 0)) {
        setError("Sq/ft needs length and width in feet");
        return;
      }
      if (!(pcs > 0)) {
        setError("Sq/ft needs pieces per packet");
        return;
      }
      if (!(rateN > 0)) {
        setError("Sq/ft needs ₹ per sqft");
        return;
      }
    }
    const codeTrim = code.trim() || `SKU-${Date.now().toString(36).toUpperCase()}`;
    const sizeEn = isSqftUnit(unit) ? sqftSizeLabel(lFt, wFt) : size.trim();
    let variation: ProductVariation = {
      id: `var_${crypto.randomUUID()}`,
      label: { en: sizeEn || "Standard", hi: sizeEn || "स्टैंडर्ड" },
      size: { en: sizeEn, hi: sizeEn },
      sku: `${codeTrim}-1`,
      rate: rateN,
      weightKg: wt,
      stock: 0,
      stockSecondary: 0,
      ...(isSqftUnit(unit)
        ? {
            lengthFt: lFt,
            widthFt: wFt,
            pcsPerPacket: pcs,
            ratePerSqft: rateN,
          }
        : {}),
    };
    const product: Product = {
      id: `prod_${crypto.randomUUID()}`,
      code: codeTrim,
      category,
      itemName: { en: name.trim(), hi: name.trim() },
      name: { en: name.trim(), hi: name.trim() },
      description: { en: "", hi: "" },
      unit,
      baseRate: rateN,
      ratePerSqft: isSqftUnit(unit) ? rateN : undefined,
      lengthFt: isSqftUnit(unit) ? lFt : undefined,
      widthFt: isSqftUnit(unit) ? wFt : undefined,
      pcsPerPacket: isSqftUnit(unit) ? pcs : undefined,
      baseWeightKg: wt,
      pricingMode: isPackCountUnit(unit) ? "pcs" : "bundle",
      brand: "TT",
      hsnCode: "",
      minOrderQty: 1,
      variations: [variation],
      colors: [
        {
          id: `col_${crypto.randomUUID()}`,
          name: { en: "Blue", hi: "नीला" },
          hex: "#1d4ed8",
        },
      ],
      media: [],
      logoUrl: "",
      active: true,
      featured: false,
      stock: 0,
      stockSecondary: 0,
      createdAt: now,
      updatedAt: now,
    };
    if (isSqftUnit(unit)) {
      product.variations = [
        applySqftComputedRate(product, product.variations[0]),
      ];
      variation = product.variations[0];
      product.baseRate = variation.rate;
    }
    upsertProduct(product);
    refresh();
    onCreated(product, variation.id);
    onClose();
  };

  return (
    <ModalShell title="New catalog item" onClose={onClose}>
      <form onSubmit={onSubmit} className="space-y-3">
        <div>
          <label className="tt-label">Name</label>
          <input
            className="tt-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            autoFocus
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="tt-label">Code / SKU</label>
            <input
              className="tt-input"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="Auto if blank"
            />
          </div>
          <div>
            <label className="tt-label">Category</label>
            <select
              className="tt-select"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            >
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name.en}
                </option>
              ))}
              {!categories.length ? (
                <option value="tarpaulin">Tarpaulin</option>
              ) : null}
            </select>
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          {isSqftUnit(unit) ? (
            <>
              <div>
                <label className="tt-label">Length (ft)</label>
                <NumberField
                  className="tt-input"
                  min={0}
                  step={0.01}
                  emptyAs={null}
                  value={lengthFt}
                  onValueChange={setLengthFt}
                />
              </div>
              <div>
                <label className="tt-label">Width (ft)</label>
                <NumberField
                  className="tt-input"
                  min={0}
                  step={0.01}
                  emptyAs={null}
                  value={widthFt}
                  onValueChange={setWidthFt}
                />
              </div>
              <div>
                <label className="tt-label">Pcs / packet</label>
                <NumberField
                  className="tt-input"
                  min={0}
                  integer
                  emptyAs={null}
                  value={pcsPerPacket}
                  onValueChange={setPcsPerPacket}
                />
              </div>
            </>
          ) : (
            <div>
              <label className="tt-label">Size / variation</label>
              <input
                className="tt-input"
                value={size}
                onChange={(e) => setSize(e.target.value)}
                placeholder="e.g. 12x18"
              />
            </div>
          )}
          <div>
            <label className="tt-label">Unit</label>
            <select
              className="tt-select"
              value={unit}
              onChange={(e) => setUnit(e.target.value as UnitOfSale)}
            >
              <option value="kg">kg</option>
              <option value="pcs">pcs</option>
              <option value="pkt">pkt/pc</option>
              <option value="sqft">sq/ft</option>
              <option value="jhal">jhal</option>
            </select>
          </div>
          <div>
            <label className="tt-label">
              {isSqftUnit(unit) ? "₹ / sqft" : "Rate"}
            </label>
            <NumberField
              className="tt-input"
              value={rate}
              onValueChange={setRate}
            />
          </div>
        </div>
        {isSqftUnit(unit) &&
        typeof lengthFt === "number" &&
        typeof widthFt === "number" &&
        typeof pcsPerPacket === "number" &&
        typeof rate === "number" &&
        lengthFt > 0 &&
        widthFt > 0 &&
        pcsPerPacket > 0 &&
        rate > 0 ? (
          <p className="text-xs text-[var(--ink-muted)]">
            {sqftSizeLabel(lengthFt, widthFt)} ·{" "}
            {formatInr(ratePerPiece(rate, lengthFt, widthFt))}
            /pc ·{" "}
            {formatInr(ratePerPacket(rate, lengthFt, widthFt, pcsPerPacket))}
            /pkt
          </p>
        ) : null}
        <div>
          <label className="tt-label">Kg per bundle (optional)</label>
          <NumberField
            className="tt-input max-w-xs"
            value={weightKg}
            onValueChange={setWeightKg}
          />
        </div>
        {error ? <p className="text-sm text-[var(--danger)]">{error}</p> : null}
        <button type="submit" className="tt-btn tt-btn-dark">
          Save item
        </button>
      </form>
    </ModalShell>
  );
}
