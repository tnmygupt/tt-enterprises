import type {
  Account,
  GoodsReceipt,
  Order,
  Party,
  Product,
  Voucher,
} from "./types";

export type SearchHitKind =
  | "party"
  | "voucher"
  | "product"
  | "account"
  | "order"
  | "grn";

export type SearchHit = {
  kind: SearchHitKind;
  id: string;
  title: string;
  subtitle: string;
  href: string;
  score: number;
};

export type SearchableDb = {
  parties: Party[];
  vouchers: Voucher[];
  products: Product[];
  accounts: Account[];
  orders: Order[];
  goodsReceipts?: GoodsReceipt[];
  purchaseOrders?: { id: string; supplierId: string }[];
};

function scoreMatch(hay: string, q: string): number {
  const h = hay.toLowerCase();
  if (!q) return 0;
  if (h === q) return 100;
  if (h.startsWith(q)) return 80;
  if (h.includes(q)) return 50;
  const tokens = q.split(/\s+/).filter(Boolean);
  if (tokens.every((t) => h.includes(t))) return 40;
  return 0;
}

/** Search parties, vouchers, products, accounts, orders, GRNs. */
export function searchAccountsEverywhere(
  db: SearchableDb,
  query: string,
  opts: { includePurchases?: boolean; limit?: number } = {}
): SearchHit[] {
  const q = query.trim().toLowerCase();
  if (q.length < 1) return [];
  const limit = opts.limit ?? 40;
  const hits: SearchHit[] = [];

  for (const p of db.parties) {
    if (!p.active) continue;
    if (p.type === "supplier" && opts.includePurchases === false) continue;
    const hay = `${p.name} ${p.phone} ${p.gstin ?? ""}`;
    const s = scoreMatch(hay, q);
    if (!s) continue;
    hits.push({
      kind: "party",
      id: p.id,
      title: p.name,
      subtitle: `${p.type} · ${p.phone || "no phone"}`,
      href: `/admin/accounts/party-statement?party=${encodeURIComponent(p.id)}&type=${p.type}`,
      score: s + 5,
    });
  }

  for (const v of db.vouchers) {
    if (v.voided && !q.includes("void")) {
      // still searchable by number
    }
    const party = db.parties.find((p) => p.id === v.partyId);
    const hay = `${v.number} ${v.type} ${v.narration ?? ""} ${party?.name ?? ""} ${v.linkedOrderId ?? ""}`;
    const s = scoreMatch(hay, q);
    if (!s) continue;
    hits.push({
      kind: "voucher",
      id: v.id,
      title: v.number,
      subtitle: `${v.type}${v.voided ? " · voided" : ""} · ${v.date}${party ? ` · ${party.name}` : ""}`,
      href: `/admin/accounts/vouchers?id=${encodeURIComponent(v.id)}`,
      score: s,
    });
  }

  for (const p of db.products) {
    if (!p.active) continue;
    const hay = `${p.code} ${p.name.en} ${p.name.hi} ${p.itemName?.en ?? ""}`;
    const s = scoreMatch(hay, q);
    if (!s) continue;
    hits.push({
      kind: "product",
      id: p.id,
      title: p.name.en,
      subtitle: `${p.code} · stock ${p.stock}`,
      href: `/admin/accounts/inventory?q=${encodeURIComponent(p.code || p.name.en)}`,
      score: s,
    });
  }

  for (const a of db.accounts) {
    if (!a.active) continue;
    const hay = `${a.code} ${a.name.en} ${a.name.hi} ${a.type}`;
    const s = scoreMatch(hay, q);
    if (!s) continue;
    hits.push({
      kind: "account",
      id: a.id,
      title: `${a.code} · ${a.name.en}`,
      subtitle: a.type,
      href: `/admin/accounts/ledger?account=${encodeURIComponent(a.id)}`,
      score: s,
    });
  }

  for (const o of db.orders) {
    if (o.status === "cancelled" && !q.includes("cancel")) continue;
    const hay = `${o.orderNumber} ${o.userName ?? ""} ${o.phone ?? ""} ${o.userEmail ?? ""}`;
    const s = scoreMatch(hay, q);
    if (!s) continue;
    hits.push({
      kind: "order",
      id: o.id,
      title: o.orderNumber,
      subtitle: `${o.status} · ${o.userName || o.phone || ""}`,
      href: `/admin/orders?q=${encodeURIComponent(o.orderNumber)}`,
      score: s,
    });
  }

  for (const g of db.goodsReceipts ?? []) {
    if (g.voided) continue;
    const po = db.purchaseOrders?.find((p) => p.id === g.poId);
    const supplier = db.parties.find((p) => p.id === po?.supplierId);
    const hay = `${g.number} ${g.narration ?? ""} ${g.poId} ${supplier?.name ?? ""}`;
    const s = scoreMatch(hay, q);
    if (!s) continue;
    hits.push({
      kind: "grn",
      id: g.id,
      title: g.number,
      subtitle: `GRN · ${g.date}${supplier ? ` · ${supplier.name}` : ""}`,
      href: `/admin/accounts/goods-received?id=${encodeURIComponent(g.id)}`,
      score: s,
    });
  }

  return hits
    .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title))
    .slice(0, limit);
}

export const SEARCH_KIND_LABEL: Record<SearchHitKind, string> = {
  party: "Party",
  voucher: "Voucher",
  product: "Product",
  account: "Account",
  order: "Order",
  grn: "Goods in",
};
