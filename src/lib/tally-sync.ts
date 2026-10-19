import { normalizeProductStock } from "@/lib/inventory";
import type {
  AppSettings,
  Order,
  OrderStatus,
  Product,
  ProductVariation,
  TallyBlockedReason,
  TallyItem,
  TallyLedger,
  TallyMasterSource,
  TallyPost,
  TallyPostLine,
  UserProfile,
} from "@/lib/types";

/** Order statuses that hold stock until Tally acknowledges the sale. */
const TALLY_HOLD_STATUSES = new Set<OrderStatus>([
  "confirmed",
  "payment_pending",
  "payment_verified",
  "dispatched",
  "delivered",
]);

const SALE_STATUSES = TALLY_HOLD_STATUSES;

/** Legacy bridge payload: one stock line per Tally item. */
export type TallyStockInput = {
  productId?: string;
  variationId?: string;
  tallyItemId?: string;
  sku?: string;
  name?: string;
  guid?: string;
  unit?: string;
  parent?: string;
  stock: number;
};

export type TallyUnknownItem = {
  tallyItemId?: string;
  sku?: string;
  name?: string;
  stock: number;
  reason: "unmatched" | "ambiguous" | "unlinked";
};

export type TallyApplyResult = {
  applied: number;
  unknown: TallyUnknownItem[];
};

export type TallyRegistryItemInput = {
  name: string;
  guid?: string;
  unit?: string;
  parent?: string;
  /** Closing quantity. `stock` / `closingQty` accepted as aliases. */
  closing?: number;
  closingQty?: number;
  stock?: number;
  /** Optional explicit website target (legacy MAP_*). Ignored when the row is already linked. */
  productId?: string;
  variationId?: string;
};

export type TallyRegistryLedgerInput = {
  name: string;
  guid?: string;
  parent?: string;
  /** Top-most group (Sundry Debtors, Bank Accounts, …) when the bridge resolved it. */
  primaryGroup?: string;
  gstin?: string;
  phone?: string;
};

export type TallyRegistryInput = {
  items?: TallyRegistryItemInput[];
  ledgers?: TallyRegistryLedgerInput[];
  /** True when the list is the complete Tally master list (marks absent rows missing). */
  full?: boolean;
  source?: TallyMasterSource;
};

export type TallyRegistryCounts = {
  received: number;
  created: number;
  updated: number;
  missing: number;
};

export type TallyRegistryResult = {
  items: TallyRegistryCounts;
  ledgers: TallyRegistryCounts;
};

/** Slice of the app database the Tally bridge reads and writes. */
export type TallyDb = {
  products: Product[];
  orders: Order[];
  tallyPosts: TallyPost[];
  tallyItems?: TallyItem[];
  tallyLedgers?: TallyLedger[];
  users: UserProfile[];
  settings: AppSettings;
};

export type StockTarget = { product: Product; variationId?: string };

function norm(value: string | undefined | null): string {
  return (value || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function finiteStock(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function phoneKey(value: string | undefined | null): string {
  return (value || "").replace(/\D/g, "").slice(-10);
}

/** Stable registry id for a Tally name. */
export function tallyMasterId(name: string): string {
  return norm(name);
}

function itemsOf(db: TallyDb): TallyItem[] {
  if (!db.tallyItems) db.tallyItems = [];
  return db.tallyItems;
}

function ledgersOf(db: TallyDb): TallyLedger[] {
  if (!db.tallyLedgers) db.tallyLedgers = [];
  return db.tallyLedgers;
}

const PARTY_GROUP = /sundry\s*(debtors|creditors)/i;
const NON_PARTY_GROUP =
  /bank|cash|duties|tax|sales accounts|purchase accounts|expense|income|capital|loan|fixed asset|investment|suspense|profit|reserve|stock-in-hand|current assets|current liabilities|branch\s*\/\s*divisions/i;

/**
 * Party ledgers can be linked to a dealer. A blank group or a subgroup whose
 * top group we do not know stays linkable. Banks, tax, expenses and similar
 * groups are not.
 */
export function isTallyPartyGroup(
  ledger: Pick<TallyLedger, "parent"> & { primaryGroup?: string }
): boolean {
  const top = (ledger.primaryGroup || "").trim();
  if (top) return PARTY_GROUP.test(top);
  const parent = (ledger.parent || "").trim();
  if (!parent || PARTY_GROUP.test(parent)) return true;
  return !NON_PARTY_GROUP.test(parent);
}

// ---------------------------------------------------------------------------
// Registry upsert
// ---------------------------------------------------------------------------

type MasterRow = TallyItem | TallyLedger;

function findMaster<T extends MasterRow>(
  rows: T[],
  input: { name: string; guid?: string }
): T | undefined {
  const guid = (input.guid || "").trim();
  if (guid) {
    const byGuid = rows.find((r) => r.guid && r.guid === guid);
    if (byGuid) return byGuid;
  }
  const id = tallyMasterId(input.name);
  return rows.find((r) => r.id === id || norm(r.name) === id);
}

type MasterInput<T extends MasterRow> = { name: string; guid?: string } & Partial<T>;

function upsertMasters<T extends MasterRow, I extends MasterInput<T>>(
  rows: T[],
  inputs: I[] | undefined,
  full: boolean,
  source: TallyMasterSource,
  now: string,
  onCreate?: (row: T, input: I) => void
): TallyRegistryCounts {
  const counts: TallyRegistryCounts = {
    received: 0,
    created: 0,
    updated: 0,
    missing: 0,
  };
  if (!Array.isArray(inputs)) return counts;
  const seen = new Set<string>();
  for (const raw of inputs) {
    const name = (raw?.name || "").trim();
    if (!name) continue;
    counts.received += 1;
    const existing = findMaster(rows, { name, guid: raw.guid });
    if (existing) {
      if (seen.has(existing.id)) continue;
      seen.add(existing.id);
      existing.name = name;
      if (raw.guid) existing.guid = raw.guid;
      if (raw.parent) existing.parent = raw.parent;
      existing.lastSeenAt = now;
      existing.missingSince = undefined;
      if (source === "bridge") existing.source = "bridge";
      applyMasterFields(existing, raw);
      counts.updated += 1;
      continue;
    }
    const row = {
      id: tallyMasterId(name),
      name,
      guid: raw.guid || undefined,
      parent: raw.parent || undefined,
      source,
      firstSeenAt: now,
      lastSeenAt: now,
    } as T;
    applyMasterFields(row, raw);
    onCreate?.(row, raw);
    rows.push(row);
    seen.add(row.id);
    counts.created += 1;
  }
  if (full && counts.received > 0) {
    for (const row of rows) {
      if (seen.has(row.id)) continue;
      if (!row.missingSince) row.missingSince = now;
      counts.missing += 1;
    }
  }
  return counts;
}

function applyMasterFields<T extends MasterRow>(row: T, raw: Partial<T>): void {
  const item = row as TallyItem;
  const src = raw as Partial<TallyItem> & Partial<TallyLedger> & {
    closing?: number;
    stock?: number;
  };
  if (src.unit) item.unit = String(src.unit);
  const qty = finiteStock(src.closingQty ?? src.closing ?? src.stock);
  if (qty != null) item.closingQty = qty;
  const ledger = row as TallyLedger;
  if (src.gstin !== undefined) ledger.gstin = src.gstin || undefined;
  if (src.phone !== undefined) ledger.phone = src.phone || undefined;
}

/**
 * Mirror Tally stock items and party ledgers as raw rows. Existing links and
 * office decisions (ignore) are kept. With `full`, rows Tally no longer lists
 * are flagged `missingSince` but never deleted.
 */
export function upsertTallyRegistry(
  db: TallyDb,
  input: TallyRegistryInput,
  now = new Date().toISOString()
): TallyRegistryResult {
  const source: TallyMasterSource = input.source || "bridge";
  const full = !!input.full;
  const items = upsertMasters(
    itemsOf(db),
    input.items?.map((i) => ({
      name: i.name,
      guid: i.guid,
      unit: i.unit,
      parent: i.parent,
      closingQty: finiteStock(i.closingQty ?? i.closing ?? i.stock) ?? undefined,
    })),
    full,
    source,
    now
  );
  const ledgers = upsertMasters(
    ledgersOf(db),
    input.ledgers?.map((l) => ({
      name: l.name,
      guid: l.guid,
      parent: l.parent,
      gstin: l.gstin,
      phone: l.phone,
      primaryGroup: l.primaryGroup,
    })),
    full,
    source,
    now,
    (row, raw) => {
      // Banks, expenses, duties… are mirrored but never need a dealer link.
      if (!isTallyPartyGroup({ parent: raw.parent, primaryGroup: raw.primaryGroup })) {
        row.ignoredAt = now;
      }
    }
  );
  migrateTallyItemLinks(db);
  for (const raw of input.items ?? []) {
    const productId = (raw.productId || "").trim();
    if (!productId) continue;
    const row = findMaster(itemsOf(db), { name: raw.name, guid: raw.guid });
    if (!row || tallyItemLinks(db).get(row.id)?.length) continue;
    const product = db.products.find((p) => p.id === productId);
    if (!product) continue;
    let variationId = raw.variationId;
    if (!variationId && product.variations.length === 1) {
      variationId = product.variations[0].id;
    }
    if (variationId && !product.variations.some((v) => v.id === variationId)) continue;
    if (!variationId && product.variations.length > 1) continue;
    linkTallyItem(db, row.id, { productId, variationId }, now);
  }
  return { items, ledgers };
}

/**
 * Free-text `tallyItemId` values typed before the registry existed become
 * real links when they equal a Tally name.
 */
export function migrateTallyItemLinks(db: TallyDb): number {
  const rows = itemsOf(db);
  if (!rows.length) return 0;
  const byId = new Map(rows.map((r) => [r.id, r] as const));
  const byName = new Map(rows.map((r) => [norm(r.name), r] as const));
  let changed = 0;
  const fix = (holder: { tallyItemId?: string }) => {
    const raw = (holder.tallyItemId || "").trim();
    if (!raw || byId.has(raw)) return;
    const row = byId.get(norm(raw)) || byName.get(norm(raw));
    if (row) {
      holder.tallyItemId = row.id;
      changed += 1;
    }
  };
  for (const product of db.products) {
    fix(product);
    for (const variation of product.variations ?? []) fix(variation);
  }
  return changed;
}

// ---------------------------------------------------------------------------
// Links: products / sizes → Tally items
// ---------------------------------------------------------------------------

function namesOf(product: Product, variationId?: string): string[] {
  const variation = variationId
    ? product.variations.find((v) => v.id === variationId)
    : undefined;
  const raw = variation
    ? [
        variation.label?.en,
        variation.label?.hi,
        variation.sku,
        product.name?.en && variation.label?.en
          ? `${product.name.en} ${variation.label.en}`
          : "",
        product.code && variation.label?.en
          ? `${product.code} ${variation.label.en}`
          : "",
      ]
    : [
        product.name?.en,
        product.name?.hi,
        product.itemName?.en,
        product.itemName?.hi,
        product.code,
      ];
  return raw.map((s) => norm(s)).filter(Boolean);
}

export function stockTargets(products: Product[]): StockTarget[] {
  const out: StockTarget[] = [];
  for (const product of products) {
    if (product.variations?.length) {
      for (const variation of product.variations) {
        out.push({ product, variationId: variation.id });
      }
    } else {
      out.push({ product });
    }
  }
  return out;
}

export function targetKey(target: { productId: string; variationId?: string }): string {
  return `${target.productId}:${target.variationId || ""}`;
}

function variationOf(target: StockTarget): ProductVariation | undefined {
  return target.variationId
    ? target.product.variations.find((v) => v.id === target.variationId)
    : undefined;
}

/** The Tally item id a target is linked to (variation first, then product). */
export function targetTallyItemId(target: StockTarget): string {
  const variation = variationOf(target);
  if (target.variationId) return (variation?.tallyItemId || "").trim();
  return (target.product.tallyItemId || "").trim();
}

/** Map of Tally item row id → linked website targets. */
export function tallyItemLinks(db: TallyDb): Map<string, StockTarget[]> {
  const rows = itemsOf(db);
  const ids = new Set(rows.map((r) => r.id));
  const out = new Map<string, StockTarget[]>();
  for (const target of stockTargets(db.products)) {
    const id = targetTallyItemId(target);
    if (!id || !ids.has(id)) continue;
    const list = out.get(id) ?? [];
    list.push(target);
    out.set(id, list);
  }
  return out;
}

export function unlinkedTallyItems(db: TallyDb): TallyItem[] {
  const links = tallyItemLinks(db);
  return itemsOf(db).filter(
    (r) => !r.ignoredAt && !r.missingSince && !links.has(r.id)
  );
}

/** Website products / sizes with no registry link (or a typed name Tally lacks). */
export function unlinkedStockTargets(db: TallyDb): StockTarget[] {
  const ids = new Set(itemsOf(db).map((r) => r.id));
  return stockTargets(db.products).filter((t) => {
    if (t.product.rawMaterial) return false;
    const id = targetTallyItemId(t);
    return !id || !ids.has(id);
  });
}

function unique(matches: StockTarget[]): StockTarget | null {
  if (!matches.length) return null;
  const keys = new Set(
    matches.map((m) => targetKey({ productId: m.product.id, variationId: m.variationId }))
  );
  return keys.size === 1 ? matches[0] : null;
}

/** Unique exact name / SKU / code match among targets that are not linked yet. */
export function suggestTallyItemLink(
  db: TallyDb,
  row: Pick<TallyItem, "name">
): StockTarget | null {
  const name = norm(row.name);
  if (!name) return null;
  const ids = new Set(itemsOf(db).map((r) => r.id));
  const free = stockTargets(db.products).filter((t) => {
    const id = targetTallyItemId(t);
    return !id || !ids.has(id);
  });
  return unique(free.filter((t) => namesOf(t.product, t.variationId).includes(name)));
}

/** Link one Tally item row to one website target (or clear with `null`). */
export function linkTallyItem(
  db: TallyDb,
  rowId: string,
  target: { productId: string; variationId?: string } | null,
  now = new Date().toISOString()
): boolean {
  const row = itemsOf(db).find((r) => r.id === rowId);
  if (!row) return false;
  for (const t of stockTargets(db.products)) {
    if (targetTallyItemId(t) !== rowId) continue;
    const variation = variationOf(t);
    if (t.variationId && variation) variation.tallyItemId = undefined;
    else if (!t.variationId) t.product.tallyItemId = undefined;
    t.product.updatedAt = now;
  }
  if (!target) return true;
  const product = db.products.find((p) => p.id === target.productId);
  if (!product) return false;
  if (target.variationId) {
    const variation = product.variations.find((v) => v.id === target.variationId);
    if (!variation) return false;
    variation.tallyItemId = rowId;
    if (row.closingQty != null) {
      variation.tallyOnHand = row.closingQty;
      variation.stock = row.closingQty;
    }
  } else {
    product.tallyItemId = rowId;
    if (row.closingQty != null) {
      product.tallyOnHand = row.closingQty;
      product.stock = row.closingQty;
    }
  }
  product.updatedAt = now;
  const idx = db.products.findIndex((p) => p.id === product.id);
  if (idx >= 0) db.products[idx] = normalizeProductStock(product);
  applyTallyAvailability(db, now);
  unblockTallyPosts(db, now);
  return true;
}

export function ignoreTallyItem(
  db: TallyDb,
  rowId: string,
  ignored: boolean,
  now = new Date().toISOString()
): boolean {
  const row = itemsOf(db).find((r) => r.id === rowId);
  if (!row) return false;
  row.ignoredAt = ignored ? now : undefined;
  row.updatedAt = now;
  return true;
}

/** Link every unlinked row that has exactly one exact-name / SKU match. */
export function autoLinkTallyItems(db: TallyDb, now = new Date().toISOString()): number {
  let linked = 0;
  for (const row of unlinkedTallyItems(db)) {
    const hit = suggestTallyItemLink(db, row);
    if (!hit) continue;
    if (
      linkTallyItem(
        db,
        row.id,
        { productId: hit.product.id, variationId: hit.variationId },
        now
      )
    ) {
      linked += 1;
    }
  }
  return linked;
}

const UNIT_MAP: Record<string, Product["unit"]> = {
  kg: "kg",
  kgs: "kg",
  kilogram: "kg",
  pcs: "pcs",
  pc: "pcs",
  nos: "pcs",
  no: "pcs",
  pieces: "pcs",
  pkt: "pkt",
  pkts: "pkt",
  packet: "pkt",
  packets: "pkt",
  jhal: "jhal",
  sqft: "sqft",
};

function unitFromTally(unit: string | undefined): Product["unit"] {
  return UNIT_MAP[norm(unit)] || "pcs";
}

function codeFromName(name: string, taken: Set<string>): string {
  const base =
    name
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 24) || "TALLY";
  let code = base;
  let n = 2;
  while (taken.has(code)) code = `${base}-${n++}`;
  return code;
}

/**
 * Create an inactive website product from a Tally item so the office can
 * finish rates / category in Products. The link is set immediately.
 */
export function createProductFromTallyItem(
  db: TallyDb,
  rowId: string,
  opts: { category?: string; id?: string } = {},
  now = new Date().toISOString()
): Product | null {
  const row = itemsOf(db).find((r) => r.id === rowId);
  if (!row) return null;
  const already = tallyItemLinks(db).get(rowId)?.[0];
  if (already) return already.product;
  const taken = new Set(db.products.map((p) => norm(p.code).toUpperCase()));
  const product: Product = {
    id: opts.id || `prod_tally_${Math.random().toString(36).slice(2, 10)}`,
    code: codeFromName(row.name, taken),
    category: opts.category || "tarpaulin",
    itemName: { en: row.name, hi: row.name },
    name: { en: row.name, hi: row.name },
    description: { en: "", hi: "" },
    unit: unitFromTally(row.unit),
    baseRate: 0,
    baseWeightKg: 1,
    pricingMode: "bundle",
    minOrderQty: 1,
    variations: [],
    colors: [],
    media: [],
    active: false,
    featured: false,
    stock: row.closingQty ?? 0,
    tallyItemId: row.id,
    tallyOnHand: row.closingQty ?? undefined,
    createdAt: now,
    updatedAt: now,
  };
  db.products.push(normalizeProductStock(product));
  unblockTallyPosts(db, now);
  return product;
}

/** Add a size to an existing product from a Tally item and link it. */
export function createVariationFromTallyItem(
  db: TallyDb,
  rowId: string,
  productId: string,
  opts: { id?: string } = {},
  now = new Date().toISOString()
): ProductVariation | null {
  const row = itemsOf(db).find((r) => r.id === rowId);
  const product = db.products.find((p) => p.id === productId);
  if (!row || !product) return null;
  if (tallyItemLinks(db).has(rowId)) return null;
  const taken = new Set(
    db.products.flatMap((p) => p.variations.map((v) => norm(v.sku).toUpperCase()))
  );
  const variation: ProductVariation = {
    id: opts.id || `var_tally_${Math.random().toString(36).slice(2, 10)}`,
    label: { en: row.name, hi: row.name },
    size: { en: row.name, hi: row.name },
    sku: codeFromName(row.name, taken),
    rate: product.baseRate || 0,
    stock: row.closingQty ?? 0,
    tallyItemId: row.id,
    tallyOnHand: row.closingQty ?? undefined,
  };
  product.variations.push(variation);
  product.updatedAt = now;
  const idx = db.products.findIndex((p) => p.id === product.id);
  if (idx >= 0) db.products[idx] = normalizeProductStock(product);
  applyTallyAvailability(db, now);
  unblockTallyPosts(db, now);
  return variation;
}

// ---------------------------------------------------------------------------
// Links: dealers → Tally ledgers
// ---------------------------------------------------------------------------

function ledgerById(db: TallyDb, id: string | undefined): TallyLedger | undefined {
  if (!id) return undefined;
  return ledgersOf(db).find((r) => r.id === id);
}

export function linkedTallyLedger(
  db: TallyDb,
  user: Pick<UserProfile, "tallyLedgerId"> | undefined
): TallyLedger | undefined {
  return ledgerById(db, user?.tallyLedgerId);
}

/** Party ledgers nobody on the website is linked to yet. */
export function unlinkedTallyLedgers(db: TallyDb): TallyLedger[] {
  const used = new Set(
    db.users.map((u) => (u.tallyLedgerId || "").trim()).filter(Boolean)
  );
  return ledgersOf(db).filter(
    (r) => !r.ignoredAt && !r.missingSince && !used.has(r.id)
  );
}

/** Approved dealers who still post sales under a typed name. */
export function dealersWithoutTallyLedger(db: TallyDb): UserProfile[] {
  const ids = new Set(ledgersOf(db).map((r) => r.id));
  return db.users.filter(
    (u) =>
      u.role === "customer" &&
      u.active !== false &&
      (!u.tallyLedgerId || !ids.has(u.tallyLedgerId))
  );
}

function userNames(user: UserProfile): string[] {
  return [user.name, user.company].map((s) => norm(s)).filter(Boolean);
}

/** GSTIN, then phone, then exact name — unique among dealers with no link. */
export function suggestTallyLedgerLink(
  db: TallyDb,
  row: Pick<TallyLedger, "name" | "gstin" | "phone">
): UserProfile | null {
  const ids = new Set(ledgersOf(db).map((r) => r.id));
  const free = db.users.filter(
    (u) => u.role === "customer" && (!u.tallyLedgerId || !ids.has(u.tallyLedgerId))
  );
  const one = (list: UserProfile[]) => (list.length === 1 ? list[0] : null);
  const gstin = (row.gstin || "").trim().toUpperCase();
  if (gstin) {
    const hit = one(
      free.filter((u) => (u.gstOrAadhar || "").trim().toUpperCase() === gstin)
    );
    if (hit) return hit;
  }
  const phone = phoneKey(row.phone);
  if (phone.length >= 10) {
    const hit = one(free.filter((u) => phoneKey(u.phone) === phone));
    if (hit) return hit;
  }
  const name = norm(row.name);
  if (!name) return null;
  return one(free.filter((u) => userNames(u).includes(name)));
}

export function linkTallyLedger(
  db: TallyDb,
  rowId: string,
  userId: string | null,
  now = new Date().toISOString()
): boolean {
  const row = ledgerById(db, rowId);
  if (!row) return false;
  for (const u of db.users) {
    if (u.tallyLedgerId === rowId) u.tallyLedgerId = undefined;
  }
  if (userId) {
    const user = db.users.find((u) => u.id === userId);
    if (!user) return false;
    user.tallyLedgerId = rowId;
  }
  unblockTallyPosts(db, now);
  return true;
}

export function ignoreTallyLedger(
  db: TallyDb,
  rowId: string,
  ignored: boolean,
  now = new Date().toISOString()
): boolean {
  const row = ledgerById(db, rowId);
  if (!row) return false;
  row.ignoredAt = ignored ? now : undefined;
  row.updatedAt = now;
  return true;
}

export function autoLinkTallyLedgers(db: TallyDb, now = new Date().toISOString()): number {
  let linked = 0;
  for (const row of unlinkedTallyLedgers(db)) {
    const hit = suggestTallyLedgerLink(db, row);
    if (hit && linkTallyLedger(db, row.id, hit.id, now)) linked += 1;
  }
  return linked;
}

/** Queue a Sundry Debtors ledger for the bridge to create in Tally. */
export function requestTallyLedger(
  db: TallyDb,
  userId: string,
  now = new Date().toISOString()
): TallyPost | null {
  const user = db.users.find((u) => u.id === userId);
  if (!user) return null;
  if (!db.tallyPosts) db.tallyPosts = [];
  const remoteId = `WEB-LEDGER-${user.id}`;
  const existing = db.tallyPosts.find((p) => p.remoteId === remoteId);
  const name = (user.company || user.name || "").trim() || `Dealer ${user.phone}`;
  const ledger = {
    name,
    parent: "Sundry Debtors",
    gstin: looksLikeGstin(user.gstOrAadhar),
    phone: user.phone || undefined,
    address: user.address || undefined,
    userId: user.id,
  };
  if (existing) {
    if (existing.status === "posted") return existing;
    existing.ledger = ledger;
    existing.partyName = name;
    existing.status = "pending";
    existing.lastError = undefined;
    return existing;
  }
  const post: TallyPost = {
    id: `tally_ledger_${user.id}`,
    kind: "ledger",
    orderId: "",
    orderNumber: "",
    remoteId,
    partyName: name,
    partyPhone: user.phone || undefined,
    partyGstin: ledger.gstin,
    amount: 0,
    date: now.slice(0, 10),
    narration: `Website dealer ${user.phone}`,
    ledger,
    status: "pending",
    attempts: 0,
    createdAt: now,
  };
  db.tallyPosts.push(post);
  return post;
}

/**
 * Registry rows are bridge-owned. A browser may only change `ignoredAt`,
 * and only when its `updatedAt` is newer than the cloud row.
 */
export function mergeTallyMasters<T extends { id: string; ignoredAt?: string; updatedAt?: string }>(
  cloud: T[] | undefined,
  incoming: T[] | undefined
): T[] {
  const out = (cloud ?? []).map((row) => ({ ...row }));
  const byId = new Map(out.map((row) => [row.id, row]));
  for (const row of incoming ?? []) {
    if (!row?.id) continue;
    const prev = byId.get(row.id);
    if (!prev) continue;
    const prevAt = prev.updatedAt || "";
    const nextAt = row.updatedAt || "";
    if (nextAt && nextAt > prevAt && prev.ignoredAt !== row.ignoredAt) {
      prev.ignoredAt = row.ignoredAt;
      prev.updatedAt = nextAt;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Stock
// ---------------------------------------------------------------------------

function touchTarget(target: StockTarget, stock: number, now: string) {
  if (target.variationId) {
    const variation = variationOf(target);
    if (!variation) return;
    variation.tallyOnHand = stock;
    variation.stock = stock;
  } else {
    target.product.tallyOnHand = stock;
    target.product.stock = stock;
  }
  target.product.updatedAt = now;
}

/** Copy registry closing quantities onto linked products, then reserve unacked sales. */
export function applyLinkedTallyStock(
  db: TallyDb,
  now = new Date().toISOString()
): TallyApplyResult {
  const links = tallyItemLinks(db);
  const unknown: TallyUnknownItem[] = [];
  let applied = 0;
  for (const row of itemsOf(db)) {
    if (row.closingQty == null || !Number.isFinite(row.closingQty)) continue;
    if (row.missingSince) continue;
    const targets = links.get(row.id);
    if (!targets?.length) {
      if (!row.ignoredAt) {
        unknown.push({
          tallyItemId: row.id,
          name: row.name,
          stock: row.closingQty,
          reason: "unlinked",
        });
      }
      continue;
    }
    for (const target of targets) touchTarget(target, row.closingQty, now);
    applied += 1;
  }
  for (let i = 0; i < db.products.length; i += 1) {
    db.products[i] = normalizeProductStock(db.products[i]);
  }
  applyTallyAvailability(db, now);
  db.settings.tallyLastSyncAt = now;
  db.settings.tallySyncStatus = "ok";
  db.settings.tallySyncMessage =
    unknown.length > 0
      ? `Synced ${applied} linked item(s) from Tally · ${unknown.length} not linked yet`
      : `Synced ${applied} linked item(s) from Tally`;
  return { applied, unknown };
}

/**
 * Legacy bridge payload: register every line as a Tally item, honour an
 * explicit productId / variationId mapping, then apply stock through links.
 */
export function applyTallyStock(
  db: TallyDb,
  items: TallyStockInput[],
  now = new Date().toISOString()
): TallyApplyResult {
  const registry: TallyRegistryItemInput[] = [];
  for (const item of items) {
    const stock = finiteStock(item?.stock);
    const name = (item.name || item.tallyItemId || item.sku || "").trim();
    if (stock == null || !name) continue;
    registry.push({
      name,
      guid: item.guid,
      unit: item.unit,
      parent: item.parent,
      closing: stock,
    });
  }
  upsertTallyRegistry(db, { items: registry, full: false }, now);
  for (const item of items) {
    const productId = (item.productId || "").trim();
    if (!productId) continue;
    const name = (item.name || item.tallyItemId || item.sku || "").trim();
    const row = findMaster(itemsOf(db), { name, guid: item.guid });
    if (!row) continue;
    const product = db.products.find((p) => p.id === productId);
    if (!product) continue;
    let variationId = item.variationId;
    if (!variationId && product.variations.length === 1) {
      variationId = product.variations[0].id;
    }
    if (variationId && !product.variations.some((v) => v.id === variationId)) continue;
    if (!variationId && product.variations.length > 1) continue;
    const current = tallyItemLinks(db).get(row.id);
    if (current?.length) continue;
    linkTallyItem(db, row.id, { productId, variationId }, now);
  }
  return applyLinkedTallyStock(db, now);
}

function postedSaleOrderIds(posts: TallyPost[] | undefined): Set<string> {
  const ids = new Set<string>();
  for (const post of posts ?? []) {
    if (post.kind === "sale" && post.status === "posted" && post.orderId) {
      ids.add(post.orderId);
    }
  }
  return ids;
}

/** Qty on confirmed-or-later orders whose Tally sale is not posted yet. */
export function reservedTallyQty(
  db: Pick<TallyDb, "orders" | "tallyPosts">,
  productId: string,
  variationId?: string
): number {
  const posted = postedSaleOrderIds(db.tallyPosts);
  let qty = 0;
  for (const order of db.orders ?? []) {
    if (!TALLY_HOLD_STATUSES.has(order.status)) continue;
    if (posted.has(order.id)) continue;
    for (const line of order.lines ?? []) {
      if (line.productId !== productId) continue;
      if (variationId) {
        if (line.variationId !== variationId) continue;
      } else if (line.variationId) {
        continue;
      }
      const q = Number(line.quantity);
      if (Number.isFinite(q) && q > 0) qty += q;
    }
  }
  return qty;
}

/**
 * Displayed stock = last Tally on-hand minus unacknowledged confirmed orders.
 * Products Tally has not reported are left alone.
 */
export function applyTallyAvailability(db: TallyDb, now = new Date().toISOString()): void {
  for (let i = 0; i < db.products.length; i += 1) {
    const product = db.products[i];
    let touched = false;
    if (product.variations?.length) {
      for (const variation of product.variations) {
        if (variation.tallyOnHand == null || !Number.isFinite(variation.tallyOnHand)) {
          continue;
        }
        const next = Math.max(
          0,
          variation.tallyOnHand - reservedTallyQty(db, product.id, variation.id)
        );
        if (variation.stock !== next) {
          variation.stock = next;
          touched = true;
        }
      }
    } else if (product.tallyOnHand != null && Number.isFinite(product.tallyOnHand)) {
      const next = Math.max(
        0,
        product.tallyOnHand - reservedTallyQty(db, product.id)
      );
      if (product.stock !== next) {
        product.stock = next;
        touched = true;
      }
    }
    if (touched) {
      product.updatedAt = now;
      db.products[i] = normalizeProductStock(product);
    }
  }
}

// ---------------------------------------------------------------------------
// Sales queue
// ---------------------------------------------------------------------------

function looksLikeGstin(value: string | undefined): string | undefined {
  const s = (value || "").trim().toUpperCase();
  return /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][A-Z0-9]Z[A-Z0-9]$/.test(s) ? s : undefined;
}

function saleLines(db: TallyDb, order: Order): TallyPostLine[] {
  const rows = new Map(itemsOf(db).map((r) => [r.id, r] as const));
  return (order.lines ?? []).map((line) => {
    const product = db.products.find((p) => p.id === line.productId);
    const variation = product?.variations.find((v) => v.id === line.variationId);
    const linkId = (variation?.tallyItemId || product?.tallyItemId || "").trim();
    const row = rows.get(linkId);
    return {
      productId: line.productId,
      variationId: line.variationId,
      tallyItemId: linkId || undefined,
      tallyItemName: row?.name,
      sku: variation?.sku || line.productCode || product?.code,
      name: line.productName?.en || line.productCode || "Item",
      qty: Number(line.quantity) || 0,
      rate: Number(line.rate) || 0,
      amount: Number(line.lineTotal) || 0,
    };
  });
}

function saleAmount(order: Order): number {
  if ((order.actualBillAmount ?? 0) > 0) return order.actualBillAmount as number;
  return order.estimatedTotal || 0;
}

/**
 * Why a sale cannot go to Tally yet. Only enforced once the registry holds
 * that master type, so a site without ledger data keeps posting as before.
 */
export function saleBlockedReason(
  db: TallyDb,
  order: Order,
  lines: TallyPostLine[]
): TallyBlockedReason | undefined {
  const user = db.users.find((u) => u.id === order.userId);
  if (ledgersOf(db).length > 0 && !linkedTallyLedger(db, user)) return "ledger";
  if (itemsOf(db).length > 0 && lines.some((l) => !l.tallyItemName)) return "item";
  return undefined;
}

/** One pending sale per order. A second call keeps the same remoteId. */
export function enqueueTallySale(
  db: TallyDb,
  order: Order,
  now = new Date().toISOString()
): TallyPost | null {
  if (!SALE_STATUSES.has(order.status)) return null;
  if (!(saleAmount(order) > 0) && !(order.lines?.length)) return null;
  if (!db.tallyPosts) db.tallyPosts = [];
  const existing = db.tallyPosts.find(
    (p) => p.orderId === order.id && p.kind === "sale"
  );
  const user = db.users.find((u) => u.id === order.userId);
  const ledger = linkedTallyLedger(db, user);
  const gstin =
    ledger?.gstin ||
    looksLikeGstin(order.gstOrAadhar) ||
    looksLikeGstin(user?.gstOrAadhar);
  const partyName =
    ledger?.name || order.checkoutName || order.userName || user?.name || "Customer";
  const partyPhone = order.phone || user?.phone || "";
  const lines = saleLines(db, order);
  const amount = saleAmount(order);
  const date = (order.billUploadedAt || order.updatedAt || now).slice(0, 10);
  const blockedReason = saleBlockedReason(db, order, lines);

  if (existing) {
    if (existing.status === "posted") return existing;
    existing.partyName = partyName;
    existing.partyPhone = partyPhone || undefined;
    existing.partyGstin = gstin;
    existing.amount = amount;
    existing.date = date;
    existing.lines = lines;
    existing.blockedReason = blockedReason;
    existing.narration = `Website order ${order.orderNumber}`;
    if (existing.status === "failed" && existing.lastError === "Order cancelled") {
      existing.status = "pending";
      existing.lastError = undefined;
      existing.attempts = 0;
    }
    return existing;
  }

  const post: TallyPost = {
    id: `tally_${order.id}`,
    kind: "sale",
    orderId: order.id,
    orderNumber: order.orderNumber,
    remoteId: `WEB-SALE-${order.orderNumber}`,
    partyName,
    partyPhone: partyPhone || undefined,
    partyGstin: gstin,
    amount,
    date,
    narration: `Website order ${order.orderNumber}`,
    lines,
    blockedReason,
    status: "pending",
    attempts: 0,
    createdAt: now,
  };
  db.tallyPosts.push(post);
  return post;
}

/** Re-evaluate held sales after a link, ledger ack, or product change. */
export function unblockTallyPosts(db: TallyDb, now = new Date().toISOString()): number {
  let released = 0;
  for (const post of db.tallyPosts ?? []) {
    if (post.kind !== "sale" || post.status === "posted" || !post.blockedReason) continue;
    const order = db.orders.find((o) => o.id === post.orderId);
    if (!order) continue;
    const before = post.blockedReason;
    enqueueTallySale(db, order, now);
    if (before && !post.blockedReason) released += 1;
  }
  return released;
}

/** Posts the bridge may pick up now. Ledgers first so sales find their party. */
export function tallyPostsForBridge(posts: TallyPost[] | undefined): TallyPost[] {
  const open = (posts ?? []).filter(
    (p) =>
      (p.status === "pending" || p.status === "failed") &&
      !p.blockedReason &&
      p.lastError !== "Order cancelled"
  );
  const rank = (p: TallyPost) => (p.kind === "ledger" ? 0 : 1);
  return open.sort(
    (a, b) => rank(a) - rank(b) || String(a.createdAt).localeCompare(String(b.createdAt))
  );
}

/** Stop a not-yet-posted sale so the bridge does not invoice a cancelled order. */
export function cancelTallySale(db: TallyDb, orderId: string, now = new Date().toISOString()): void {
  const post = (db.tallyPosts ?? []).find(
    (p) => p.orderId === orderId && p.kind === "sale"
  );
  if (!post || post.status === "posted") return;
  post.status = "failed";
  post.lastError = "Order cancelled";
  post.postedAt = undefined;
  if (!post.createdAt) post.createdAt = now;
}

/** Drop posted qty from Tally on-hand so stock stays down until the next snapshot. */
function consumePostedSale(db: TallyDb, post: TallyPost): void {
  const rows = new Map(itemsOf(db).map((r) => [r.id, r] as const));
  for (const line of post.lines ?? []) {
    const qty = Number(line.qty) || 0;
    if (!(qty > 0)) continue;
    const row = line.tallyItemId ? rows.get(line.tallyItemId) : undefined;
    if (row?.closingQty != null) row.closingQty = Math.max(0, row.closingQty - qty);
    if (!line.productId) continue;
    const product = db.products.find((p) => p.id === line.productId);
    if (!product) continue;
    if (line.variationId) {
      const variation = product.variations.find((v) => v.id === line.variationId);
      if (variation?.tallyOnHand != null) {
        variation.tallyOnHand = Math.max(0, variation.tallyOnHand - qty);
      }
    } else if (product.tallyOnHand != null) {
      product.tallyOnHand = Math.max(0, product.tallyOnHand - qty);
    }
  }
}

/** A ledger Tally accepted becomes a registry row linked to its dealer. */
function registerPostedLedger(db: TallyDb, post: TallyPost, now: string): void {
  const ledger = post.ledger;
  if (!ledger?.name) return;
  upsertTallyRegistry(
    db,
    {
      ledgers: [
        {
          name: ledger.name,
          parent: ledger.parent,
          primaryGroup: ledger.parent,
          gstin: ledger.gstin,
          phone: ledger.phone,
        },
      ],
    },
    now
  );
  const row = findMaster(ledgersOf(db), { name: ledger.name });
  if (row && ledger.userId) linkTallyLedger(db, row.id, ledger.userId, now);
}

export function ackTallyPost(
  db: TallyDb,
  remoteId: string,
  status: "posted" | "failed",
  error?: string,
  now = new Date().toISOString()
): TallyPost | null {
  const post = (db.tallyPosts ?? []).find((p) => p.remoteId === remoteId);
  if (!post) return null;
  if (post.status === "posted" && status === "posted") return post;
  post.attempts = (post.attempts || 0) + 1;
  if (status === "posted") {
    post.status = "posted";
    post.postedAt = now;
    post.lastError = undefined;
    post.blockedReason = undefined;
    if (post.kind === "ledger") registerPostedLedger(db, post, now);
    else consumePostedSale(db, post);
  } else {
    post.status = "failed";
    post.lastError = (error || "Tally rejected the voucher").slice(0, 500);
  }
  return post;
}

const STATUS_RANK: Record<TallyPost["status"], number> = {
  pending: 1,
  failed: 2,
  posted: 3,
};

/** Keep cloud posts. Accept new client posts. Never let a pending copy undo a post. */
export function mergeTallyPosts(
  cloud: TallyPost[] | undefined,
  incoming: TallyPost[] | undefined
): TallyPost[] {
  const byKey = new Map<string, TallyPost>();
  const keyOf = (p: TallyPost) => p.remoteId || p.id;
  for (const post of cloud ?? []) {
    if (post?.id) byKey.set(keyOf(post), post);
  }
  for (const post of incoming ?? []) {
    if (!post?.id) continue;
    const key = keyOf(post);
    const prev = byKey.get(key);
    if (!prev) {
      byKey.set(key, post);
      continue;
    }
    const prevRank = STATUS_RANK[prev.status] ?? 0;
    const nextRank = STATUS_RANK[post.status] ?? 0;
    if (nextRank > prevRank) byKey.set(key, post);
  }
  return [...byKey.values()];
}

/** Copy Tally on-hand from cloud when a staff push omitted it. */
export function restoreTallyOnHand(products: Product[], cloudProducts: Product[]): void {
  const byId = new Map(cloudProducts.map((p) => [p.id, p]));
  for (const product of products) {
    const cloud = byId.get(product.id);
    if (!cloud) continue;
    if (product.tallyOnHand == null && cloud.tallyOnHand != null) {
      product.tallyOnHand = cloud.tallyOnHand;
    }
    if (!product.tallyItemId && cloud.tallyItemId) product.tallyItemId = cloud.tallyItemId;
    for (const variation of product.variations ?? []) {
      const cv = cloud.variations?.find((v) => v.id === variation.id);
      if (!cv) continue;
      if (variation.tallyOnHand == null && cv.tallyOnHand != null) {
        variation.tallyOnHand = cv.tallyOnHand;
      }
      if (!variation.tallyItemId && cv.tallyItemId) variation.tallyItemId = cv.tallyItemId;
    }
  }
}

export function tallySyncIsConnected(db: {
  settings?: { tallyLastSyncAt?: string };
  products?: Product[];
}): boolean {
  if (db.settings?.tallyLastSyncAt) return true;
  return (db.products ?? []).some(
    (p) =>
      p.tallyOnHand != null ||
      (p.variations ?? []).some((v) => v.tallyOnHand != null)
  );
}

export function preferTallySyncSettings(
  target: { settings?: AppSettings },
  cloud: { settings?: AppSettings }
): void {
  if (!target.settings || !cloud.settings) return;
  const cloudAt = cloud.settings.tallyLastSyncAt || "";
  const targetAt = target.settings.tallyLastSyncAt || "";
  if (cloudAt > targetAt) {
    target.settings.tallyLastSyncAt = cloud.settings.tallyLastSyncAt;
    target.settings.tallySyncStatus = cloud.settings.tallySyncStatus;
    target.settings.tallySyncMessage = cloud.settings.tallySyncMessage;
  }
}

export function tallyKeyOk(
  provided: string | null | undefined,
  expected: string | undefined
): boolean {
  const want = expected || "tt-enterprises-tally-dev-key";
  return !!provided && provided === want;
}

// ---------------------------------------------------------------------------
// Summary for the admin desk / queue badge
// ---------------------------------------------------------------------------

export type TallyRegistrySummary = {
  items: { total: number; linked: number; unlinked: number; missing: number; ignored: number };
  ledgers: { total: number; linked: number; unlinked: number; missing: number; ignored: number };
  blockedSales: number;
  /** Website sizes / products with no Tally link (only once items exist). */
  unlinkedTargets: number;
  /** Everything that needs a human decision. */
  needsLink: number;
};

export function tallyRegistrySummary(
  db: Pick<TallyDb, "products" | "users" | "tallyPosts"> &
    Partial<Pick<TallyDb, "tallyItems" | "tallyLedgers" | "orders" | "settings">>
): TallyRegistrySummary {
  const full: TallyDb = {
    products: db.products ?? [],
    orders: db.orders ?? [],
    tallyPosts: db.tallyPosts ?? [],
    tallyItems: db.tallyItems ?? [],
    tallyLedgers: db.tallyLedgers ?? [],
    users: db.users ?? [],
    settings: (db.settings ?? {}) as AppSettings,
  };
  const items = full.tallyItems ?? [];
  const ledgers = full.tallyLedgers ?? [];
  const itemLinks = tallyItemLinks(full);
  const usedLedgers = new Set(
    full.users.map((u) => (u.tallyLedgerId || "").trim()).filter(Boolean)
  );
  const unlinkedItems = unlinkedTallyItems(full).length;
  const unlinkedLedgers = unlinkedTallyLedgers(full).length;
  const blockedSales = full.tallyPosts.filter(
    (p) => p.kind === "sale" && p.status !== "posted" && !!p.blockedReason
  ).length;
  const unlinkedTargets = items.length ? unlinkedStockTargets(full).length : 0;
  return {
    items: {
      total: items.length,
      linked: items.filter((r) => itemLinks.has(r.id)).length,
      unlinked: unlinkedItems,
      missing: items.filter((r) => !!r.missingSince).length,
      ignored: items.filter((r) => !!r.ignoredAt).length,
    },
    ledgers: {
      total: ledgers.length,
      linked: ledgers.filter((r) => usedLedgers.has(r.id)).length,
      unlinked: unlinkedLedgers,
      missing: ledgers.filter((r) => !!r.missingSince).length,
      ignored: ledgers.filter((r) => !!r.ignoredAt).length,
    },
    blockedSales,
    unlinkedTargets,
    needsLink: unlinkedItems + unlinkedLedgers + blockedSales,
  };
}
