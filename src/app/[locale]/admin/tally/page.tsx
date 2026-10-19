"use client";

import { FormEvent, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { AdminAccessDenied } from "@/components/AdminAccessDenied";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { AdminShell } from "@/components/AdminShell";
import { useDb, useSession } from "@/lib/hooks";
import type { AppDatabase } from "@/lib/store/db";
import {
  addProductFromTallyItem,
  addSizeFromTallyItem,
  autoLinkTallyItemMatches,
  autoLinkTallyLedgerMatches,
  hasCapability,
  linkDealerToTallyLedger,
  linkProductToTallyItem,
  queueTallyLedgerForDealer,
  setTallyItemIgnored,
  setTallyLedgerIgnored,
} from "@/lib/store/db";
import {
  dealersWithoutTallyLedger,
  stockTargets,
  suggestTallyItemLink,
  suggestTallyLedgerLink,
  tallyItemLinks,
  targetTallyItemId,
  unlinkedStockTargets,
  type TallyDb,
} from "@/lib/tally-sync";
import type { TallyItem, TallyLedger, TallyPost } from "@/lib/types";

type Tab = "items" | "ledgers" | "sales" | "import" | "setup";
type RowFilter = "new" | "linked" | "missing" | "ignored" | "all";

function asTallyDb(db: AppDatabase): TallyDb {
  return db;
}

function rowState(
  row: { id: string; ignoredAt?: string; missingSince?: string },
  linked: boolean
): Exclude<RowFilter, "all"> {
  if (row.ignoredAt) return "ignored";
  if (row.missingSince) return "missing";
  return linked ? "linked" : "new";
}

export default function AdminTallyPage() {
  const t = useTranslations();
  const { session } = useSession();
  const { db, refresh } = useDb();
  const [tab, setTab] = useState<Tab>("items");
  const [filter, setFilter] = useState<RowFilter>("new");
  const [query, setQuery] = useState("");
  const [msg, setMsg] = useState("");

  const view = useMemo(() => {
    if (!db) return null;
    const data = asTallyDb(db);
    const links = tallyItemLinks(data);
    const usedLedgers = new Set(
      (db.users ?? []).map((u) => u.tallyLedgerId || "").filter(Boolean)
    );
    return {
      data,
      links,
      usedLedgers,
      targets: stockTargets(db.products ?? []),
      siteGaps: unlinkedStockTargets(data),
      dealerGaps: dealersWithoutTallyLedger(data),
    };
  }, [db]);

  if (!session || !hasCapability(session.role, "manage_products")) {
    return (
      <AdminShell>
        <AdminAccessDenied />
      </AdminShell>
    );
  }

  if (!db || !view) {
    return (
      <AdminShell>
        <p>{t("common.loading")}</p>
      </AdminShell>
    );
  }

  const items = db.tallyItems ?? [];
  const ledgers = db.tallyLedgers ?? [];
  const sales = (db.tallyPosts ?? []).filter(
    (p) => p.kind === "sale" && p.status !== "posted"
  );
  const q = query.trim().toLowerCase();
  const match = (name: string) => !q || name.toLowerCase().includes(q);

  const tabs: { id: Tab; label: string; count?: number }[] = [
    {
      id: "items",
      label: t("admin.tallyTabItems"),
      count: items.filter((r) => rowState(r, view.links.has(r.id)) === "new").length,
    },
    {
      id: "ledgers",
      label: t("admin.tallyTabLedgers"),
      count: ledgers.filter((r) => rowState(r, view.usedLedgers.has(r.id)) === "new").length,
    },
    {
      id: "sales",
      label: t("admin.tallyTabSales"),
      count: sales.filter((p) => p.blockedReason).length,
    },
    { id: "import", label: t("admin.tallyTabImport") },
    { id: "setup", label: t("admin.tallyTabSetup") },
  ];

  return (
    <AdminShell>
      <AdminPageHeader title={t("admin.tally")} hint={t("admin.tallyHint")} />

      <div className="mt-6 rounded-2xl bg-[var(--brand-deep)] p-5 text-white">
        <p className="text-sm text-[#b7c9bc]">{t("admin.tallySyncStatus")}</p>
        <p className="mt-1 text-xl font-semibold capitalize">
          {db.settings.tallySyncStatus}
        </p>
        <p className="mt-2 text-sm text-[#c5d4ca]">{db.settings.tallySyncMessage}</p>
        {db.settings.tallyLastSyncAt ? (
          <p className="mt-2 text-xs text-[#9fb0a5]">
            {t("admin.lastSync")}: {new Date(db.settings.tallyLastSyncAt).toLocaleString()}
          </p>
        ) : null}
        <p className="mt-2 text-xs text-[#9fb0a5]">
          {items.length} items · {ledgers.length} ledgers
        </p>
      </div>

      <div className="mt-6 flex flex-wrap gap-2">
        {tabs.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => {
              setTab(item.id);
              setMsg("");
            }}
            className={`tt-btn ${tab === item.id ? "tt-btn-dark" : ""}`}
          >
            {item.label}
            {item.count ? ` (${item.count})` : ""}
          </button>
        ))}
      </div>

      {tab === "items" ? (
        <section className="mt-6">
          <Toolbar
            filter={filter}
            onFilter={setFilter}
            query={query}
            onQuery={setQuery}
            searchLabel={t("admin.tallySearch")}
            filters={[
              ["new", t("admin.tallyFilterNew")],
              ["linked", t("admin.tallyFilterLinked")],
              ["missing", t("admin.tallyFilterMissing")],
              ["ignored", t("admin.tallyFilterIgnored")],
              ["all", t("admin.tallyFilterAll")],
            ]}
          />
          <button
            type="button"
            className="tt-btn mt-3"
            onClick={() => {
              const n = autoLinkTallyItemMatches();
              setMsg(n ? `Linked ${n}` : t("admin.tallyNone"));
              refresh();
            }}
          >
            {t("admin.tallyAutoLink")}
          </button>
          {msg ? <p className="mt-2 text-sm text-[var(--brand)]">{msg}</p> : null}
          <div className="mt-4 space-y-3">
            {items
              .filter((row) => match(row.name))
              .filter((row) => filter === "all" || rowState(row, view.links.has(row.id)) === filter)
              .map((row) => (
                <ItemCard
                  key={row.id}
                  row={row}
                  db={view.data}
                  products={db.products}
                  onDone={refresh}
                  t={t}
                />
              ))}
          </div>
          <h2 className="mt-8 font-semibold">{t("admin.tallyUnlinkedSite")}</h2>
          <ul className="mt-2 space-y-1 text-sm">
            {view.siteGaps.length ? (
              view.siteGaps.map((target) => {
                const typed = targetTallyItemId(target);
                return (
                  <li key={`${target.product.id}:${target.variationId || ""}`}>
                    {target.product.code} — {target.product.name.en}
                    {target.variationId
                      ? ` · ${target.product.variations.find((v) => v.id === target.variationId)?.label.en || ""}`
                      : ""}
                    {typed ? ` · typed “${typed}” is not in Tally` : ""}
                  </li>
                );
              })
            ) : (
              <li className="text-[var(--ink-muted)]">{t("admin.tallyNone")}</li>
            )}
          </ul>
        </section>
      ) : null}

      {tab === "ledgers" ? (
        <section className="mt-6">
          <Toolbar
            filter={filter}
            onFilter={setFilter}
            query={query}
            onQuery={setQuery}
            searchLabel={t("admin.tallySearch")}
            filters={[
              ["new", t("admin.tallyFilterNew")],
              ["linked", t("admin.tallyFilterLinked")],
              ["missing", t("admin.tallyFilterMissing")],
              ["ignored", t("admin.tallyFilterIgnored")],
              ["all", t("admin.tallyFilterAll")],
            ]}
          />
          <button
            type="button"
            className="tt-btn mt-3"
            onClick={() => {
              const n = autoLinkTallyLedgerMatches();
              setMsg(n ? `Linked ${n}` : t("admin.tallyNone"));
              refresh();
            }}
          >
            {t("admin.tallyAutoLink")}
          </button>
          {msg ? <p className="mt-2 text-sm text-[var(--brand)]">{msg}</p> : null}
          <div className="mt-4 space-y-3">
            {ledgers
              .filter((row) => match(row.name))
              .filter(
                (row) =>
                  filter === "all" || rowState(row, view.usedLedgers.has(row.id)) === filter
              )
              .map((row) => (
                <LedgerCard
                  key={row.id}
                  row={row}
                  db={view.data}
                  users={db.users.filter((u) => u.role === "customer")}
                  onDone={refresh}
                  t={t}
                />
              ))}
          </div>
          <h2 className="mt-8 font-semibold">{t("admin.tallyDealersWithout")}</h2>
          <ul className="mt-2 space-y-2 text-sm">
            {view.dealerGaps.length ? (
              view.dealerGaps.map((user) => (
                <li key={user.id} className="flex flex-wrap items-center gap-2">
                  <span>
                    {user.name}
                    {user.company ? ` · ${user.company}` : ""} · {user.phone}
                  </span>
                  <button
                    type="button"
                    className="tt-btn"
                    onClick={() => {
                      queueTallyLedgerForDealer(user.id);
                      refresh();
                    }}
                  >
                    {t("admin.tallyCreateLedger")}
                  </button>
                </li>
              ))
            ) : (
              <li className="text-[var(--ink-muted)]">{t("admin.tallyNone")}</li>
            )}
          </ul>
        </section>
      ) : null}

      {tab === "sales" ? (
        <section className="mt-6 space-y-3">
          {sales.length ? (
            sales.map((post) => (
              <SaleCard
                key={post.id}
                post={post}
                orderUserId={db.orders.find((o) => o.id === post.orderId)?.userId}
                users={db.users.filter((u) => u.role === "customer")}
                ledgers={ledgers}
                onDone={refresh}
                onOpenItems={() => setTab("items")}
                t={t}
              />
            ))
          ) : (
            <p className="text-sm text-[var(--ink-muted)]">{t("admin.tallyNone")}</p>
          )}
        </section>
      ) : null}

      {tab === "import" ? (
        <ImportPanel
          help={t("admin.tallyImportHelp")}
          onDone={async (text) => {
            setMsg(text);
            const sync = await import("@/lib/supabase/sync");
            const { loadDb, replaceDbFromCloud } = await import("@/lib/store/db");
            const remote = await sync.pullCloudDatabase(loadDb());
            if (remote) replaceDbFromCloud(remote);
            refresh();
          }}
        />
      ) : null}

      {tab === "setup" ? (
        <ol className="mt-6 list-decimal space-y-2 pl-5 text-sm text-[var(--ink-muted)]">
          <li>Enable TallyPrime HTTP on the office PC (port 9000 by default).</li>
          <li>
            On that PC, copy <code>tally-bridge/.env.example</code> to <code>.env</code>.
            Set the company name, this site&apos;s <code>/api/tally/sync</code> URL, and the same{" "}
            <code>TALLY_SYNC_KEY</code> as the website.
          </li>
          <li>
            Run <code>npm install</code> then <code>npm start</code> in <code>tally-bridge</code>.
            Each cycle copies every stock item and ledger here.
          </li>
          <li>
            Link items and dealers on this page. Stock moves only after a link. A sale waits
            until the dealer ledger and every line item are linked.
          </li>
          <li>
            Until the bridge runs, use Import with a Tally List of Accounts export. That stores
            names only.
          </li>
        </ol>
      ) : null}
    </AdminShell>
  );
}

function Toolbar({
  filter,
  onFilter,
  query,
  onQuery,
  searchLabel,
  filters,
}: {
  filter: RowFilter;
  onFilter: (next: RowFilter) => void;
  query: string;
  onQuery: (next: string) => void;
  searchLabel: string;
  filters: [RowFilter, string][];
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {filters.map(([id, label]) => (
        <button
          key={id}
          type="button"
          onClick={() => onFilter(id)}
          className={`tt-btn ${filter === id ? "tt-btn-dark" : ""}`}
        >
          {label}
        </button>
      ))}
      <input
        className="tt-input max-w-xs"
        value={query}
        placeholder={searchLabel}
        onChange={(e) => onQuery(e.target.value)}
      />
    </div>
  );
}

function ItemCard({
  row,
  db,
  products,
  onDone,
  t,
}: {
  row: TallyItem;
  db: TallyDb;
  products: AppDatabase["products"];
  onDone: () => void;
  t: ReturnType<typeof useTranslations>;
}) {
  const suggestion = suggestTallyItemLink(db, row);
  const [target, setTarget] = useState(
    suggestion
      ? `${suggestion.product.id}|${suggestion.variationId || ""}`
      : ""
  );
  const [sizeOf, setSizeOf] = useState(products[0]?.id || "");
  const options = stockTargets(products);
  return (
    <article className="rounded-2xl border border-[var(--line)] bg-white p-4">
      <p className="font-semibold">{row.name}</p>
      <p className="text-xs text-[var(--ink-muted)]">
        {[row.parent, row.unit, row.closingQty != null ? `qty ${row.closingQty}` : ""]
          .filter(Boolean)
          .join(" · ") || row.source}
        {row.missingSince ? " · missing" : ""}
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <select
          className="tt-input max-w-md"
          value={target}
          onChange={(e) => setTarget(e.target.value)}
        >
          <option value="">Website product / size</option>
          {options.map((opt) => {
            const variation = opt.variationId
              ? opt.product.variations.find((v) => v.id === opt.variationId)
              : undefined;
            return (
              <option
                key={`${opt.product.id}|${opt.variationId || ""}`}
                value={`${opt.product.id}|${opt.variationId || ""}`}
              >
                {opt.product.code} — {opt.product.name.en}
                {variation ? ` · ${variation.label.en}` : ""}
              </option>
            );
          })}
        </select>
        <button
          type="button"
          className="tt-btn tt-btn-dark"
          onClick={() => {
            if (!target) return;
            const [productId, variationId] = target.split("|");
            linkProductToTallyItem(row.id, {
              productId,
              variationId: variationId || undefined,
            });
            onDone();
          }}
        >
          {t("admin.tallyLink")}
        </button>
        <button
          type="button"
          className="tt-btn"
          onClick={() => {
            linkProductToTallyItem(row.id, null);
            onDone();
          }}
        >
          {t("admin.tallyClear")}
        </button>
        <button
          type="button"
          className="tt-btn"
          onClick={() => {
            addProductFromTallyItem(row.id);
            onDone();
          }}
        >
          {t("admin.tallyCreateProduct")}
        </button>
        <select
          className="tt-input max-w-[12rem]"
          value={sizeOf}
          onChange={(e) => setSizeOf(e.target.value)}
        >
          {products.map((p) => (
            <option key={p.id} value={p.id}>
              {p.code || p.name.en}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="tt-btn"
          disabled={!sizeOf}
          onClick={() => {
            addSizeFromTallyItem(row.id, sizeOf);
            onDone();
          }}
        >
          {t("admin.tallyCreateSize")}
        </button>
        <button
          type="button"
          className="tt-btn"
          onClick={() => {
            setTallyItemIgnored(row.id, !row.ignoredAt);
            onDone();
          }}
        >
          {row.ignoredAt ? t("admin.tallyRestore") : t("admin.tallyIgnore")}
        </button>
      </div>
    </article>
  );
}

function LedgerCard({
  row,
  db,
  users,
  onDone,
  t,
}: {
  row: TallyLedger;
  db: TallyDb;
  users: AppDatabase["users"];
  onDone: () => void;
  t: ReturnType<typeof useTranslations>;
}) {
  const suggestion = suggestTallyLedgerLink(db, row);
  const [userId, setUserId] = useState(suggestion?.id || "");
  return (
    <article className="rounded-2xl border border-[var(--line)] bg-white p-4">
      <p className="font-semibold">{row.name}</p>
      <p className="text-xs text-[var(--ink-muted)]">
        {[row.parent, row.gstin, row.phone].filter(Boolean).join(" · ") || row.source}
        {row.missingSince ? " · missing" : ""}
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <select
          className="tt-input max-w-md"
          value={userId}
          onChange={(e) => setUserId(e.target.value)}
        >
          <option value="">Dealer</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
              {u.company ? ` · ${u.company}` : ""} · {u.phone}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="tt-btn tt-btn-dark"
          onClick={() => {
            if (!userId) return;
            linkDealerToTallyLedger(row.id, userId);
            onDone();
          }}
        >
          {t("admin.tallyLink")}
        </button>
        <button
          type="button"
          className="tt-btn"
          onClick={() => {
            linkDealerToTallyLedger(row.id, null);
            onDone();
          }}
        >
          {t("admin.tallyClear")}
        </button>
        <button
          type="button"
          className="tt-btn"
          onClick={() => {
            setTallyLedgerIgnored(row.id, !row.ignoredAt);
            onDone();
          }}
        >
          {row.ignoredAt ? t("admin.tallyRestore") : t("admin.tallyIgnore")}
        </button>
      </div>
    </article>
  );
}

function SaleCard({
  post,
  orderUserId,
  users,
  ledgers,
  onDone,
  onOpenItems,
  t,
}: {
  post: TallyPost;
  orderUserId?: string;
  users: AppDatabase["users"];
  ledgers: TallyLedger[];
  onDone: () => void;
  onOpenItems: () => void;
  t: ReturnType<typeof useTranslations>;
}) {
  const [ledgerId, setLedgerId] = useState("");
  const orderUser = users.find((u) => u.id === orderUserId);
  const reason =
    post.blockedReason === "ledger"
      ? t("admin.tallyNeedsLedger")
      : post.blockedReason === "item"
        ? t("admin.tallyNeedsItem")
        : post.lastError || post.status;
  return (
    <article className="rounded-2xl border border-[var(--line)] bg-white p-4 text-sm">
      <p className="font-semibold">
        {post.orderNumber || post.remoteId} · {post.partyName} · ₹{post.amount}
      </p>
      <p className="text-[var(--ink-muted)]">{reason}</p>
      {post.blockedReason === "item" ? (
        <button type="button" className="tt-btn mt-2" onClick={onOpenItems}>
          {t("admin.tallyTabItems")}
        </button>
      ) : null}
      {post.blockedReason === "ledger" && orderUser ? (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <select
            className="tt-input max-w-md"
            value={ledgerId}
            onChange={(e) => setLedgerId(e.target.value)}
          >
            <option value="">Tally ledger</option>
            {ledgers
              .filter((l) => !l.ignoredAt)
              .map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
          </select>
          <button
            type="button"
            className="tt-btn tt-btn-dark"
            onClick={() => {
              if (!ledgerId) return;
              linkDealerToTallyLedger(ledgerId, orderUser.id);
              onDone();
            }}
          >
            {t("admin.tallyLink")}
          </button>
          <button
            type="button"
            className="tt-btn"
            onClick={() => {
              queueTallyLedgerForDealer(orderUser.id);
              onDone();
            }}
          >
            {t("admin.tallyCreateLedger")}
          </button>
        </div>
      ) : null}
    </article>
  );
}

function ImportPanel({
  help,
  onDone,
}: {
  help: string;
  onDone: (text: string) => void | Promise<void>;
}) {
  const [kind, setKind] = useState<"items" | "ledgers">("items");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    form.set("kind", kind);
    setBusy(true);
    setNote("");
    try {
      const res = await fetch("/api/tally/import", { method: "POST", body: form });
      const json = (await res.json()) as {
        error?: string;
        received?: number;
        created?: number;
        updated?: number;
      };
      if (!res.ok) {
        setNote(json.error || "Import failed");
        return;
      }
      const text = `Imported ${json.received} name(s) · ${json.created} new · ${json.updated} already there`;
      setNote(text);
      await onDone(text);
    } catch {
      setNote("Import failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={onSubmit} className="mt-6 space-y-3 rounded-2xl border border-[var(--line)] bg-white p-4">
      <p className="text-sm text-[var(--ink-muted)]">{help}</p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={`tt-btn ${kind === "items" ? "tt-btn-dark" : ""}`}
          onClick={() => setKind("items")}
        >
          Stock items
        </button>
        <button
          type="button"
          className={`tt-btn ${kind === "ledgers" ? "tt-btn-dark" : ""}`}
          onClick={() => setKind("ledgers")}
        >
          Ledgers
        </button>
      </div>
      <input className="tt-input" type="file" name="file" accept=".csv,.xlsx,.xls,text/csv" required />
      <button type="submit" className="tt-btn tt-btn-dark" disabled={busy}>
        {busy ? "…" : "Upload names"}
      </button>
      {note ? <p className="text-sm text-[var(--brand)]">{note}</p> : null}
    </form>
  );
}
