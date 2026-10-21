export const PACK_MAX_ITEMS = 8;
export const PACK_MAX_BUNDLES = 24;

export type PackSlipStatus = "draft" | "finalized";

export interface PackSlipItem {
  id: string;
  name: string;
  bundles: number;
  rate: number;
}

/** A packing slip that exists only in the packing book. */
export interface PackSlip {
  id: string;
  slipNo: string;
  status: PackSlipStatus;
  date: string;
  partyName: string;
  partyPhone: string;
  partyAddress: string;
  note: string;
  items: PackSlipItem[];
  weights: Array<Array<number | null>>;
  createdAt: string;
  updatedAt: string;
  finalizedAt?: string;
}

export function formatPackKg(n: number): string {
  if (!Number.isFinite(n)) return "0";
  const rounded = Math.round(n * 1000) / 1000;
  return String(rounded);
}

export function packSlipKg(slip: PackSlip, itemIndex: number): number {
  const rows = slip.weights[itemIndex] || [];
  const sum = rows.reduce<number>((total, n) => total + (typeof n === "number" ? n : 0), 0);
  return round3(sum);
}

export function packSlipTotalKg(slip: PackSlip): number {
  return round3(slip.items.reduce((total, _item, index) => total + packSlipKg(slip, index), 0));
}

export function packSlipAmount(slip: PackSlip, itemIndex: number): number {
  const rate = slip.items[itemIndex]?.rate || 0;
  if (!(rate > 0)) return 0;
  return round2(packSlipKg(slip, itemIndex) * rate);
}

export function packSlipTotalAmount(slip: PackSlip): number {
  return round2(slip.items.reduce((total, _item, index) => total + packSlipAmount(slip, index), 0));
}

export function nextPackSlipNo(slips: Array<{ slipNo?: string }>): string {
  let max = 1000;
  for (const slip of slips) {
    const match = /^PS-(\d+)$/.exec(String(slip.slipNo || ""));
    if (match) max = Math.max(max, Number(match[1]));
  }
  return `PS-${max + 1}`;
}

export function packWhatsappHref(slip: PackSlip): string | null {
  const digits = slip.partyPhone.replace(/\D/g, "");
  const phone = digits.length === 10 ? `91${digits}` : digits.length >= 11 ? digits : "";
  if (!phone) return null;
  const lines = [
    `Packing slip ${slip.slipNo}`,
    slip.partyName,
    ...slip.items.map((item, index) => `${item.name}: ${formatPackKg(packSlipKg(slip, index))} kg`),
    `Total: ${formatPackKg(packSlipTotalKg(slip))} kg`,
  ];
  return `https://wa.me/${phone}?text=${encodeURIComponent(lines.join("\n"))}`;
}

export function createPackSlip(input: unknown, slipNo: string, now = new Date()): PackSlip {
  const body = normalizePackSlipBody(input);
  if (!body.partyName) throw new Error("Party name is required");
  const iso = now.toISOString();
  return {
    id: newPackSlipId(),
    slipNo,
    ...body,
    status: "draft",
    createdAt: iso,
    updatedAt: iso,
  };
}

export function updatePackSlip(prev: PackSlip, input: unknown, now = new Date()): PackSlip {
  const body = normalizePackSlipBody(input);
  if (!body.partyName) throw new Error("Party name is required");
  if (prev.status === "finalized" && body.status === "finalized") {
    throw new Error("This slip is finalized");
  }
  const iso = now.toISOString();
  const finalized = body.status === "finalized";
  return {
    ...body,
    id: prev.id,
    slipNo: prev.slipNo,
    createdAt: prev.createdAt,
    updatedAt: iso,
    finalizedAt: finalized ? prev.finalizedAt || iso : undefined,
  };
}

export function addPackItem(slip: PackSlip): PackSlip {
  if (slip.items.length >= PACK_MAX_ITEMS) return slip;
  const index = slip.items.length;
  return {
    ...slip,
    items: [...slip.items, { id: `col${index + 1}`, name: "", bundles: 1, rate: 0 }],
    weights: [...slip.weights, [null]],
  };
}

export function removePackItem(slip: PackSlip, index: number): PackSlip {
  if (slip.items.length <= 1) return slip;
  return {
    ...slip,
    items: slip.items.filter((_, i) => i !== index),
    weights: slip.weights.filter((_, i) => i !== index),
  };
}

export function setPackBundles(slip: PackSlip, index: number, bundles: number): PackSlip {
  const count = clampBundles(bundles);
  const items = slip.items.map((item, i) => (i === index ? { ...item, bundles: count } : item));
  const weights = slip.weights.map((col, i) => {
    if (i !== index) return col;
    const next = col.slice(0, count);
    while (next.length < count) next.push(null);
    return next;
  });
  return { ...slip, items, weights };
}

export function setPackWeight(
  slip: PackSlip,
  itemIndex: number,
  row: number,
  kg: number | null
): PackSlip {
  const weights = slip.weights.map((col, i) => {
    if (i !== itemIndex) return col;
    const next = col.slice();
    if (row >= 0 && row < next.length) next[row] = kg == null ? null : round3(Math.max(0, kg));
    return next;
  });
  return { ...slip, weights };
}

function normalizePackSlipBody(input: unknown): Omit<
  PackSlip,
  "id" | "slipNo" | "createdAt" | "updatedAt" | "finalizedAt"
> {
  const raw = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const itemsIn = Array.isArray(raw.items) ? raw.items.slice(0, PACK_MAX_ITEMS) : [];
  const source = itemsIn.length ? itemsIn : [{}];
  const items: PackSlipItem[] = source.map((item, index) => {
    const row = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
    return {
      id: itemId(row.id, index),
      name: clip(row.name, 80),
      bundles: clampBundles(row.bundles),
      rate: money(row.rate),
    };
  });
  const weightsIn = Array.isArray(raw.weights) ? raw.weights : [];
  const weights = items.map((item, index) => {
    const col = Array.isArray(weightsIn[index]) ? weightsIn[index] : [];
    return Array.from({ length: item.bundles }, (_, row) => kg(col[row]));
  });
  const date = /^\d{4}-\d{2}-\d{2}$/.test(clip(raw.date, 10))
    ? clip(raw.date, 10)
    : new Date().toISOString().slice(0, 10);
  return {
    status: raw.status === "finalized" ? "finalized" : "draft",
    date,
    partyName: clip(raw.partyName, 120),
    partyPhone: clip(raw.partyPhone, 20),
    partyAddress: clip(raw.partyAddress, 300),
    note: clip(raw.note, 300),
    items,
    weights,
  };
}

function newPackSlipId(): string {
  const bytes = new Uint8Array(9);
  crypto.getRandomValues(bytes);
  return `ps_${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

function clip(value: unknown, max: number): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function clampBundles(value: unknown): number {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(PACK_MAX_BUNDLES, n);
}

function money(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return round2(n);
}

function kg(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return round3(n);
}

function itemId(value: unknown, index: number): string {
  const id = clip(value, 40);
  if (/^[a-zA-Z0-9_-]{4,40}$/.test(id)) return id;
  return `col${index + 1}`;
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
