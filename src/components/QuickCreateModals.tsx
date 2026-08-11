"use client";

import { FormEvent, useMemo, useState } from "react";
import { NumberField } from "@/components/NumberField";
import { useDb } from "@/lib/hooks";
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
          <label className="tt-label">GSTIN / Aadhaar</label>
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
    const codeTrim = code.trim() || `SKU-${Date.now().toString(36).toUpperCase()}`;
    const variation: ProductVariation = {
      id: `var_${crypto.randomUUID()}`,
      label: { en: size.trim() || "Standard", hi: size.trim() || "स्टैंडर्ड" },
      size: { en: size.trim(), hi: size.trim() },
      sku: `${codeTrim}-1`,
      rate: rateN,
      weightKg: wt,
      stock: 0,
      stockSecondary: 0,
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
      baseWeightKg: wt,
      pricingMode:
        unit === "pcs" || unit === "pkt" ? "pcs" : "bundle",
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
          <div>
            <label className="tt-label">Size / variation</label>
            <input
              className="tt-input"
              value={size}
              onChange={(e) => setSize(e.target.value)}
              placeholder="e.g. 12x18"
            />
          </div>
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
              <option value="jhal">jhal</option>
            </select>
          </div>
          <div>
            <label className="tt-label">Rate</label>
            <NumberField
              className="tt-input"
              value={rate}
              onValueChange={setRate}
            />
          </div>
        </div>
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
