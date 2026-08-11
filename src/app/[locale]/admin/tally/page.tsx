"use client";

import { FormEvent, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { AdminAccessDenied } from "@/components/AdminAccessDenied";
import { AdminShell } from "@/components/AdminShell";
import { useDb, useSession } from "@/lib/hooks";
import { formatInr } from "@/lib/pricing";
import {
  applyTallyStockSync,
  checkCapability,
  markTallyError,
  retryTallyPost,
  upsertProduct,
} from "@/lib/store/db";
import type { TallyPost } from "@/lib/types";

/**
 * Admin UI for mapping website products to TallyPrime stock items,
 * Phase 2 Sales/Receipt queue, and manual stock sync paste.
 */
export default function AdminTallyPage() {
  const t = useTranslations();
  const locale = useLocale() as "en" | "hi";
  const { session } = useSession();
  const { db, refresh } = useDb();
  const [payload, setPayload] = useState(
    JSON.stringify(
      [
        {
          productId: "prod_tarpaulin_hdpe",
          variationId: "var_trp_12x18",
          tallyItemId: "TRP-HDPE-120-12x18",
          stock: 180,
          stockSecondary: 7560,
        },
        {
          productId: "prod_shade_net_50",
          variationId: "var_sn_3m",
          tallyItemId: "SN-50-3M",
          stock: 420,
          stockSecondary: 1260,
        },
      ],
      null,
      2
    )
  );
  const [msg, setMsg] = useState("");

  const posts = useMemo(() => {
    const list = [...(db?.tallyPosts ?? [])];
    list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return list.slice(0, 40);
  }, [db?.tallyPosts]);

  const onSync = (e: FormEvent) => {
    e.preventDefault();
    try {
      const parsed = JSON.parse(payload) as {
        productId: string;
        variationId?: string;
        stock: number;
        stockSecondary?: number;
        tallyItemId: string;
      }[];
      applyTallyStockSync(parsed);
      setMsg(`Synced ${parsed.length} item(s)`);
      refresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Invalid JSON";
      markTallyError(message);
      setMsg(message);
      refresh();
    }
  };

  const onRetry = (post: TallyPost) => {
    try {
      retryTallyPost(post.id);
      setMsg(
        locale === "hi"
          ? `${post.remoteId} फिर से कतार में`
          : `Re-queued ${post.remoteId}`
      );
      refresh();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Retry failed");
    }
  };

  if (!session || !checkCapability(session, db?.users, "manage_tally")) {
    return (
      <AdminShell>
        <AdminAccessDenied />
      </AdminShell>
    );
  }

  if (!db) {
    return (
      <AdminShell>
        <p>{t("common.loading")}</p>
      </AdminShell>
    );
  }

  return (
    <AdminShell>
      <h1 className="tt-display text-4xl text-[var(--brand-deep)]">
        {t("admin.tally")}
      </h1>
      <p className="mt-2 max-w-2xl text-sm text-[var(--ink-muted)]">
        <strong className="font-semibold text-[var(--ink)]">
          TallyPrime is your books of record
        </strong>{" "}
        (GST, ledgers, invoices) and the stock master. This website mirrors stock
        and queues <em>simple non-GST</em> Sales / Receipt vouchers for the office
        bridge — not a second full accounts book.
      </p>
      <p className="mt-2 max-w-2xl text-sm text-[var(--ink-muted)]">
        <strong className="font-semibold text-[var(--ink)]">
          {locale === "hi" ? "यूनिट मैपिंग:" : "Unit mapping:"}
        </strong>{" "}
        {locale === "hi"
          ? "वेबसाइट बंडल = Tally Alt Qty · किग्रा/बेस = Tally मुख्य यूनिट।"
          : "Website bundles = Tally Alt Qty · kg/base = Tally primary unit."}
      </p>

      {/* --- How-to guide ------------------------------------------- */}
      <div className="mt-6 rounded-2xl border border-[var(--line)] bg-white p-5">
        <h2 className="text-base font-semibold text-[var(--ink)]">
          {locale === "hi" ? "स्टेप-बाय-स्टेप गाइड" : "How-to step guide"}
        </h2>
        <ol className="mt-3 list-decimal space-y-3 pl-5 text-sm text-[var(--ink-muted)]">
          <li>
            <span className="font-semibold text-[var(--ink)]">
              {locale === "hi" ? "Tally में यूनिट सेट करें" : "Set units in Tally"}
            </span>
            <br />
            {locale === "hi"
              ? "स्टॉक आइटम: मुख्य यूनिट = किग्रा (या pcs)। Alternate / Additional unit = Bundle। Conversion सही रखें (जैसे 1 Bundle = X kg)।"
              : "Stock item: Base unit = kg (or pcs). Alternate / Additional unit = Bundle. Keep conversion correct (e.g. 1 Bundle = X kg)."}
          </li>
          <li>
            <span className="font-semibold text-[var(--ink)]">
              {locale === "hi" ? "HTTP चालू करें" : "Enable Tally HTTP"}
            </span>
            <br />
            {locale === "hi"
              ? "TallyPrime → F1 / Connectivity → HTTP पोर्ट 9000 (या आपका पोर्ट)। कंपनी खुली रखें।"
              : "TallyPrime → F1 / Connectivity → HTTP port 9000 (or your port). Keep the company open."}
          </li>
          <li>
            <span className="font-semibold text-[var(--ink)]">
              {locale === "hi" ? "ब्रिज .env बनाएँ" : "Create bridge .env"}
            </span>
            <br />
            {locale === "hi" ? (
              <>
                ऑफिस PC पर <code>tally-bridge</code> फोल्डर में{" "}
                <code>.env.example</code> को <code>.env</code> में कॉपी करें। सेट करें:{" "}
                <code>TALLY_COMPANY</code>,{" "}
                <code>SYNC_URL=https://tanmayphotos.space/api/tally/sync</code>,{" "}
                <code>POSTS_URL=https://tanmayphotos.space/api/tally/posts</code>, और
                वेबसाइट वाला <code>TALLY_SYNC_KEY</code>। लेजर नाम:{" "}
                <code>Sales</code> / <code>Bank</code> (या Tally में जो नाम हैं)।
              </>
            ) : (
              <>
                On the office PC, in <code>tally-bridge</code>, copy{" "}
                <code>.env.example</code> → <code>.env</code>. Set{" "}
                <code>TALLY_COMPANY</code>,{" "}
                <code>SYNC_URL=https://tanmayphotos.space/api/tally/sync</code>,{" "}
                <code>POSTS_URL=https://tanmayphotos.space/api/tally/posts</code>, and
                the same <code>TALLY_SYNC_KEY</code> as the website. Ledger names:{" "}
                <code>Sales</code> / <code>Bank</code> (or your Tally names).
              </>
            )}
          </li>
          <li>
            <span className="font-semibold text-[var(--ink)]">
              {locale === "hi" ? "आइटम मैप करें" : "Map stock items"}
            </span>
            <br />
            {locale === "hi" ? (
              <>
                नीचे टेबल में <strong>Tally item ID</strong> भरे (Tally स्टॉक नाम)।
                ब्रिज <code>.env</code> में भी:{" "}
                <code>MAP_&lt;TallyName&gt;=productId:variationId</code>।
              </>
            ) : (
              <>
                Fill <strong>Tally item ID</strong> in the table below (exact Tally
                stock name). Also in bridge <code>.env</code>:{" "}
                <code>MAP_&lt;TallyName&gt;=productId:variationId</code>.
              </>
            )}
          </li>
          <li>
            <span className="font-semibold text-[var(--ink)]">
              {locale === "hi" ? "ब्रिज चलाएँ" : "Run the bridge"}
            </span>
            <br />
            <code>npm install</code> → <code>npm run once</code> (test) →{" "}
            <code>npm start</code> (every few minutes).{" "}
            {locale === "hi"
              ? "स्टॉक: Tally Alt Qty (बंडल) → वेबसाइट। साथ में Sales/Receipt पोस्ट इम्पोर्ट होते हैं।"
              : "Stock: Tally Alt Qty (bundles) → website. It also imports pending Sales/Receipt posts."}
          </li>
          <li>
            <span className="font-semibold text-[var(--ink)]">
              {locale === "hi" ? "रोज़ का फ्लो" : "Day-to-day flow"}
            </span>
            <br />
            {locale === "hi"
              ? "वेबसाइट पर फाइनल बिल → Sales कतार। पेमेंट वेरिफाई → Receipt कतार। ब्रिज Tally में डालता है। GST टैक्स लाइन नहीं जाती — जरूरत हो तो Tally में ठीक करें।"
              : "Final bill on website → Sales queued. Payment verify → Receipt queued. Bridge posts into Tally. No GST tax lines are pushed — adjust in Tally if your CA needs them."}
          </li>
        </ol>
      </div>

      <div className="mt-6 rounded-2xl bg-[var(--brand-deep)] p-5 text-white">
        <p className="text-sm text-[#b7c9bc]">Sync status</p>
        <p className="mt-1 text-xl font-semibold capitalize">
          {db.settings.tallySyncStatus}
        </p>
        <p className="mt-2 text-sm text-[#c5d4ca]">{db.settings.tallySyncMessage}</p>
        {db.settings.tallyLastSyncAt ? (
          <p className="mt-2 text-xs text-[#9fb0a5]">
            Last: {new Date(db.settings.tallyLastSyncAt).toLocaleString()}
          </p>
        ) : null}
      </div>

      <div className="mt-8">
        <h2 className="font-semibold text-[var(--ink)]">
          {locale === "hi" ? "Tally पोस्ट कतार" : "Tally post queue"}
        </h2>
        <p className="mt-1 text-xs text-[var(--ink-muted)]">
          {locale === "hi"
            ? "बिल → Sales · पेमेंट वेरिफाई → Receipt. ब्रिज pending को Tally में इम्पोर्ट करता है।"
            : "Bill → Sales · payment verify → Receipt. Bridge imports pending into Tally."}
        </p>
        <div className="mt-3 overflow-x-auto rounded-2xl border border-[var(--line)] bg-white">
          <table className="tt-table min-w-[720px]">
            <thead>
              <tr>
                <th>{locale === "hi" ? "ऑर्डर" : "Order"}</th>
                <th>{locale === "hi" ? "प्रकार" : "Kind"}</th>
                <th>{locale === "hi" ? "पार्टी" : "Party"}</th>
                <th>{locale === "hi" ? "राशि" : "Amount"}</th>
                <th>{locale === "hi" ? "स्थिति" : "Status"}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {posts.length ? (
                posts.map((p) => (
                  <tr key={p.id}>
                    <td className="font-mono text-xs">{p.orderNumber}</td>
                    <td className="capitalize">{p.kind}</td>
                    <td>{p.partyName}</td>
                    <td className="tabular-nums">
                      {formatInr(p.amount, locale)}
                    </td>
                    <td>
                      <span
                        className={`rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase ${
                          p.status === "posted"
                            ? "bg-emerald-100 text-emerald-900"
                            : p.status === "failed"
                              ? "bg-red-100 text-red-900"
                              : "bg-amber-100 text-amber-900"
                        }`}
                      >
                        {p.status}
                      </span>
                      {p.lastError ? (
                        <p className="mt-1 max-w-[220px] text-[10px] text-[var(--danger)]">
                          {p.lastError}
                        </p>
                      ) : null}
                    </td>
                    <td>
                      {p.status !== "pending" ? (
                        <button
                          type="button"
                          className="tt-btn tt-btn-outline text-xs"
                          onClick={() => onRetry(p)}
                        >
                          {locale === "hi" ? "फिर से" : "Retry"}
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={6} className="text-[var(--ink-muted)]">
                    {locale === "hi"
                      ? "अभी कोई पोस्ट नहीं — बिल या पेमेंट वेरिफाई के बाद दिखेगा।"
                      : "No posts yet — they appear after bill upload or payment verify."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="mt-8 overflow-x-auto rounded-2xl border border-[var(--line)] bg-white">
        <div className="border-b border-[var(--line)] px-4 py-3">
          <h2 className="font-semibold text-[var(--ink)]">
            {locale === "hi" ? "स्टॉक मैपिंग" : "Stock mapping"}
          </h2>
          <p className="mt-1 text-xs text-[var(--ink-muted)]">
            {locale === "hi"
              ? "बंडल = Tally Alt Qty · किग्रा = Tally बेस यूनिट। Tally item ID स्टॉक आइटम के नाम से मेल खाना चाहिए।"
              : "Bundles = Tally Alt Qty · kg = Tally base unit. Tally item ID must match the stock item name."}
          </p>
        </div>
        <table className="tt-table min-w-[800px]">
          <thead>
            <tr>
              <th>Product</th>
              <th>Variation</th>
              <th>
                {locale === "hi" ? "बंडल (Alt Qty)" : "Bundles (Alt Qty)"}
              </th>
              <th>{locale === "hi" ? "किग्रा / बेस" : "kg / base"}</th>
              <th>Tally item ID</th>
            </tr>
          </thead>
          <tbody>
            {db.products.flatMap((p) =>
              (p.variations.length ? p.variations : [null]).map((v) => (
                <tr key={`${p.id}-${v?.id ?? "base"}`}>
                  <td>
                    {p.code} — {p.name.en}
                  </td>
                  <td>{v?.label.en ?? "—"}</td>
                  <td className="tabular-nums font-semibold">
                    {v?.stock ?? p.stock}
                  </td>
                  <td className="tabular-nums text-[var(--ink-muted)]">
                    {v?.stockSecondary ?? p.stockSecondary ?? "—"}
                  </td>
                  <td>
                    <input
                      className="tt-input"
                      defaultValue={v?.tallyItemId ?? p.tallyItemId ?? ""}
                      placeholder="Tally stock item name/code"
                      onBlur={(e) => {
                        const tallyItemId = e.target.value.trim();
                        if (v) {
                          upsertProduct({
                            ...p,
                            variations: p.variations.map((x) =>
                              x.id === v.id ? { ...x, tallyItemId } : x
                            ),
                            tallyItemId: p.tallyItemId || tallyItemId,
                          });
                        } else {
                          upsertProduct({ ...p, tallyItemId });
                        }
                        refresh();
                      }}
                    />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <form onSubmit={onSync} className="mt-8 space-y-3">
        <h2 className="font-semibold">
          {locale === "hi" ? "मैनुअल स्टॉक सिंक (JSON)" : "Manual stock sync (JSON)"}
        </h2>
        <p className="text-xs text-[var(--ink-muted)]">
          {locale === "hi"
            ? "stock = बंडल (Alt Qty)। stockSecondary = किग्रा (वैकल्पिक)।"
            : "stock = bundles (Alt Qty). stockSecondary = kg (optional)."}
        </p>
        <textarea
          className="tt-textarea min-h-[220px] font-mono text-xs"
          value={payload}
          onChange={(e) => setPayload(e.target.value)}
        />
        <button type="submit" className="tt-btn tt-btn-dark">
          Apply stock sync
        </button>
        {msg ? <p className="text-sm text-[var(--brand)]">{msg}</p> : null}
      </form>
    </AdminShell>
  );
}
