import { normalizeProductStock } from "@/lib/inventory";
import type {
  AppSettings,
  CategoryDef,
  Order,
  OrderStatus,
  Product,
  TallyPost,
  TallyPostLine,
  UnitOfSale,
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

export type TallyStockInput = {
  productId?: string;
  variationId?: string;
  tallyItemId?: string;
  sku?: string;
  name?: string;
  stock: number;
  /** Used only when the website item has no selling rate yet. */
  rate?: number;
  unit?: UnitOfSale;
};

export type TallyUnknownItem = {
  tallyItemId?: string;
  sku?: string;
  name?: string;
  stock: number;
  reason: "unmatched" | "ambiguous";
};

export type TallyApplyResult = {
  applied: number;
  created: number;
  unknown: TallyUnknownItem[];
};

/** Slice of the app database the Tally bridge reads and writes. */
export type TallyDb = {
  products: Product[];
  orders: Order[];
  tallyPosts: TallyPost[];
  users: UserProfile[];
  settings: AppSettings;
  categories?: CategoryDef[];
};

type StockTarget = { product: Product; variationId?: string };

function norm(value: string | undefined | null): string {
  return (value || "").trim().toLowerCase();
}

function finiteStock(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function namesOf(product: Product, variationId?: string): string[] {
  const variation = variationId
    ? product.variations.find((v) => v.id === variationId)
    : undefined;
  const raw = variation
    ? [variation.label?.en, variation.label?.hi, variation.sku]
    : [
        product.name?.en,
        product.name?.hi,
        product.itemName?.en,
        product.itemName?.hi,
        product.code,
      ];
  return raw.map((s) => norm(s)).filter(Boolean);
}

function skusOf(product: Product, variationId?: string): string[] {
  if (variationId) {
    const variation = product.variations.find((v) => v.id === variationId);
    return [variation?.sku, product.code].map((s) => norm(s)).filter(Boolean);
  }
  return [product.code].map((s) => norm(s)).filter(Boolean);
}

function targets(products: Product[]): StockTarget[] {
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

function unique(
  matches: StockTarget[]
): StockTarget | "ambiguous" | null {
  if (!matches.length) return null;
  const keys = new Set(
    matches.map((m) => `${m.product.id}:${m.variationId || ""}`)
  );
  if (keys.size > 1) return "ambiguous";
  return matches[0];
}

function matchTallyItem(
  products: Product[],
  item: TallyStockInput
): StockTarget | "ambiguous" | null {
  const all = targets(products);
  const tallyId = norm(item.tallyItemId);
  if (tallyId) {
    const byId = unique(
      all.filter((t) => {
        const variation = t.variationId
          ? t.product.variations.find((v) => v.id === t.variationId)
          : undefined;
        const id = variation?.tallyItemId || (!t.variationId ? t.product.tallyItemId : "");
        return norm(id) === tallyId;
      })
    );
    if (byId) return byId;
  }

  const productId = (item.productId || "").trim();
  if (productId) {
    const product = products.find((p) => p.id === productId);
    if (product) {
      if (item.variationId) {
        const variation = product.variations.find((v) => v.id === item.variationId);
        if (variation) return { product, variationId: variation.id };
      } else if (!product.variations.length) {
        return { product };
      } else if (product.variations.length === 1) {
        return { product, variationId: product.variations[0].id };
      }
    }
  }

  const sku = norm(item.sku);
  if (sku) {
    const bySku = unique(
      all.filter((t) => skusOf(t.product, t.variationId).includes(sku))
    );
    if (bySku) return bySku;
  }

  const name = norm(item.name || item.tallyItemId);
  if (name) {
    const named = unique(
      all.filter((t) => namesOf(t.product, t.variationId).includes(name))
    );
    if (named) return named;
    const parents = products.filter((p) =>
      [p.name?.en, p.name?.hi, p.itemName?.en, p.itemName?.hi, p.code]
        .map((s) => norm(s))
        .includes(name)
    );
    if (parents.length > 1) return "ambiguous";
    if (parents.length === 1) {
      const product = parents[0];
      if (!product.variations.length) return { product };
      if (product.variations.length === 1) {
        return { product, variationId: product.variations[0].id };
      }
      return "ambiguous";
    }
  }

  return null;
}

const TALLY_CATEGORY = "tally";

function itemLabel(item: TallyStockInput): string {
  return (item.name || item.tallyItemId || item.sku || "").trim();
}

function slug(name: string): string {
  const s = name
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return s || "item";
}

function ensureTallyCategory(db: TallyDb): void {
  if (!db.categories) return;
  if (db.categories.some((c) => c.id === TALLY_CATEGORY)) return;
  db.categories.push({
    id: TALLY_CATEGORY,
    name: { en: "Tally", hi: "Tally" },
    active: true,
  });
}

function createTallyProduct(
  db: TallyDb,
  label: string,
  stock: number,
  now: string,
  item: TallyStockInput
): Product {
  ensureTallyCategory(db);
  let id = `tally_${slug(label)}`.slice(0, 64);
  let n = 2;
  while (db.products.some((p) => p.id === id)) {
    id = `tally_${slug(label)}_${n}`.slice(0, 64);
    n += 1;
  }
  let code = slug(label).replace(/-/g, "").toUpperCase().slice(0, 24) || "ITEM";
  n = 2;
  while (db.products.some((p) => p.code.toLowerCase() === code.toLowerCase())) {
    code = `${code.slice(0, 20)}${n}`.slice(0, 24);
    n += 1;
  }
  const rate = item.rate != null && item.rate > 0 ? item.rate : 0;
  return {
    id,
    code,
    category: TALLY_CATEGORY,
    itemName: { en: label, hi: label },
    name: { en: label, hi: label },
    description: { en: "", hi: "" },
    unit: item.unit || "pcs",
    baseRate: rate,
    pricingMode: "bundle",
    variations: [],
    colors: [],
    media: [],
    active: true,
    featured: false,
    stock,
    tallyOnHand: stock,
    tallyItemId: (item.tallyItemId || label).trim(),
    createdAt: now,
    updatedAt: now,
  };
}

function touchTarget(target: StockTarget, item: TallyStockInput, stock: number, now: string) {
  const tallyItemId = (item.tallyItemId || "").trim();
  if (target.variationId) {
    const variation = target.product.variations.find((v) => v.id === target.variationId);
    if (!variation) return;
    variation.tallyOnHand = stock;
    variation.stock = stock;
    if (tallyItemId) variation.tallyItemId = tallyItemId;
  } else {
    target.product.tallyOnHand = stock;
    target.product.stock = stock;
    if (tallyItemId) target.product.tallyItemId = tallyItemId;
  }
  target.product.updatedAt = now;
}

/** Write Tally on-hand onto matching products, then reserve unacked sales. */
export function applyTallyStock(
  db: TallyDb,
  items: TallyStockInput[],
  now = new Date().toISOString()
): TallyApplyResult {
  const unknown: TallyUnknownItem[] = [];
  let applied = 0;
  let created = 0;
  for (const item of items) {
    const stock = finiteStock(item?.stock);
    if (stock == null) continue;
    const match = matchTallyItem(db.products, item);
    if (match && match !== "ambiguous") {
      touchTarget(match, item, stock, now);
      if (item.rate != null && item.rate > 0 && !(match.product.baseRate > 0)) {
        match.product.baseRate = item.rate;
      }
      applied += 1;
      continue;
    }
    const label = itemLabel(item);
    if (match !== "ambiguous" && label.length >= 2) {
      db.products.push(createTallyProduct(db, label, stock, now, item));
      created += 1;
      applied += 1;
      continue;
    }
    unknown.push({
      tallyItemId: item.tallyItemId,
      sku: item.sku,
      name: item.name,
      stock,
      reason: match === "ambiguous" ? "ambiguous" : "unmatched",
    });
  }
  for (let i = 0; i < db.products.length; i += 1) {
    db.products[i] = normalizeProductStock(db.products[i]);
  }
  applyTallyAvailability(db, now);
  db.settings.tallyLastSyncAt = now;
  db.settings.tallySyncStatus = "ok";
  const createdNote = created > 0 ? ` · ${created} new` : "";
  const unknownNote = unknown.length > 0 ? ` · ${unknown.length} skipped` : "";
  db.settings.tallySyncMessage = `Synced ${applied} item(s) from Tally${createdNote}${unknownNote}`;
  return { applied, created, unknown };
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
  let any = false;
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
        any = true;
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
      any = true;
    }
    if (touched) {
      product.updatedAt = now;
      db.products[i] = normalizeProductStock(product);
    }
  }
  if (!any) return;
}

function looksLikeGstin(value: string | undefined): string | undefined {
  const s = (value || "").trim().toUpperCase();
  return /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][A-Z0-9]Z[A-Z0-9]$/.test(s) ? s : undefined;
}

function saleLines(db: TallyDb, order: Order): TallyPostLine[] {
  return (order.lines ?? []).map((line) => {
    const product = db.products.find((p) => p.id === line.productId);
    const variation = product?.variations.find((v) => v.id === line.variationId);
    return {
      productId: line.productId,
      variationId: line.variationId,
      tallyItemId: variation?.tallyItemId || product?.tallyItemId,
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
  const gstin = looksLikeGstin(order.gstOrAadhar) || looksLikeGstin(user?.gstOrAadhar);
  const partyName = order.checkoutName || order.userName || user?.name || "Customer";
  const partyPhone = order.phone || user?.phone || "";
  const lines = saleLines(db, order);
  const amount = saleAmount(order);
  const date = (order.billUploadedAt || order.updatedAt || now).slice(0, 10);

  if (existing) {
    if (existing.status === "posted") return existing;
    existing.partyName = partyName;
    existing.partyPhone = partyPhone || undefined;
    existing.partyGstin = gstin;
    existing.amount = amount;
    existing.date = date;
    existing.lines = lines;
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
    status: "pending",
    attempts: 0,
    createdAt: now,
  };
  db.tallyPosts.push(post);
  return post;
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
  for (const line of post.lines ?? []) {
    if (!line.productId) continue;
    const qty = Number(line.qty) || 0;
    if (!(qty > 0)) continue;
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
    consumePostedSale(db, post);
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

const NAME_HEADERS = [
  "item name",
  "name of item",
  "stock item name",
  "stock item",
  "particulars",
  "product name",
  "product",
  "item",
  "name",
];
const QTY_HEADERS = [
  "closing balance",
  "closing qty",
  "closing quantity",
  "closing stock",
  "quantity",
  "qty",
  "stock",
  "balance",
  "actual qty",
];
const RATE_HEADERS = ["selling rate", "rate", "price"];
const SKIP_NAMES = /^(total|grand total|sub total|subtotal|opening|opening stock|closing balance)$/i;

function headerKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[.]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function detectUnit(text: string): UnitOfSale | undefined {
  const s = text.toLowerCase();
  if (/\bkg\b|kilogram/.test(s)) return "kg";
  if (/\bpkt\b|\bpacket\b/.test(s)) return "pkt";
  if (/\bjhal\b/.test(s)) return "jhal";
  if (/\bsq\.?\s*ft\b|\bsqft\b/.test(s)) return "sqft";
  if (/\bpcs\b|\bnos\b|\bpc\b|\bpiece/.test(s)) return "pcs";
  return undefined;
}

export function parseQtyCell(raw: string): { stock: number; unit?: UnitOfSale } | null {
  const text = raw.trim();
  if (!text || /^[-—–]+$/.test(text)) return null;
  const negative = /^\(.*\)$/.test(text);
  const unit = detectUnit(text);
  const match = text.replace(/[()]/g, "").replace(/,/g, "").match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  let stock = Number(match[0]);
  if (!Number.isFinite(stock)) return null;
  if (negative) stock = -Math.abs(stock);
  return { stock, unit };
}

function parseRateCell(raw: string): number | undefined {
  const parsed = parseQtyCell(raw);
  if (!parsed || !(parsed.stock > 0)) return undefined;
  return parsed.stock;
}

function splitDelimited(line: string, delim: string): string[] {
  if (delim !== ",") return line.split(delim).map((s) => s.trim());
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i];
    if (quoted) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        cur += c;
      }
    } else if (c === '"') {
      quoted = true;
    } else if (c === delim) {
      out.push(cur.trim());
      cur = "";
    } else {
      cur += c;
    }
  }
  out.push(cur.trim());
  return out;
}

function detectDelim(lines: string[]): string {
  const sample = lines.slice(0, 8).join("\n");
  const tabs = (sample.match(/\t/g) || []).length;
  const semis = (sample.match(/;/g) || []).length;
  const commas = (sample.match(/,/g) || []).length;
  if (tabs >= semis && tabs >= commas && tabs > 0) return "\t";
  if (semis > commas) return ";";
  return ",";
}

function columnIndex(headers: string[], aliases: string[]): number {
  const keys = headers.map(headerKey);
  for (const alias of aliases) {
    const exact = keys.indexOf(alias);
    if (exact >= 0) return exact;
  }
  return -1;
}

function rowsToItems(rows: string[][]): TallyStockInput[] {
  const cleaned = rows
    .map((row) => row.map((cell) => String(cell ?? "").trim()))
    .filter((row) => row.some(Boolean));
  if (!cleaned.length) return [];

  let headerAt = -1;
  let nameCol = 0;
  let qtyCol = 1;
  let rateCol = -1;
  for (let i = 0; i < Math.min(cleaned.length, 30); i += 1) {
    const name = columnIndex(cleaned[i], NAME_HEADERS);
    const qty = columnIndex(cleaned[i], QTY_HEADERS);
    if (name >= 0 && qty >= 0 && name !== qty) {
      headerAt = i;
      nameCol = name;
      qtyCol = qty;
      rateCol = columnIndex(cleaned[i], RATE_HEADERS);
      break;
    }
  }

  const items: TallyStockInput[] = [];
  const start = headerAt >= 0 ? headerAt + 1 : 0;
  for (let i = start; i < cleaned.length; i += 1) {
    const row = cleaned[i];
    let name = "";
    let qtyRaw = "";
    let rateRaw = "";
    if (headerAt >= 0) {
      name = row[nameCol] || "";
      qtyRaw = row[qtyCol] || "";
      if (rateCol >= 0) rateRaw = row[rateCol] || "";
    } else {
      const texts = row.filter((cell) => cell && !parseQtyCell(cell));
      const qtyCell = row.find((cell) => parseQtyCell(cell));
      name = texts[0] || "";
      qtyRaw = qtyCell || "";
    }
    if (!name || SKIP_NAMES.test(name)) continue;
    const qty = parseQtyCell(qtyRaw);
    if (!qty) continue;
    const rate = rateRaw ? parseRateCell(rateRaw) : undefined;
    items.push({
      name,
      tallyItemId: name,
      sku: name,
      stock: qty.stock,
      unit: qty.unit,
      rate,
    });
  }
  return items;
}

/** Tally stock export: CSV, TSV, or a pasted sheet with item name and stock. */
export function parseTallyStockExport(text: string): TallyStockInput[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
    const body = JSON.parse(trimmed) as unknown;
    const raw = Array.isArray(body)
      ? body
      : body && typeof body === "object" && "items" in body
        ? (body as { items?: unknown }).items
        : null;
    if (!Array.isArray(raw)) throw new Error("Expected a list of items");
    return raw as TallyStockInput[];
  }
  const lines = trimmed.split(/\r?\n/).filter((line) => line.trim());
  const delim = detectDelim(lines);
  return rowsToItems(lines.map((line) => splitDelimited(line, delim)));
}

/** Turn an Excel sheet's rows into the same import list. */
export function parseTallyStockRows(rows: unknown[][]): TallyStockInput[] {
  return rowsToItems(
    rows.map((row) => row.map((cell) => (cell == null ? "" : String(cell))))
  );
}
