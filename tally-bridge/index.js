import "dotenv/config";

/**
 * TallyPrime bridge for TT Enterprises
 * ------------------------------------
 * Runs on the office PC where TallyPrime is installed.
 *
 * Phase 1: Export stock → POST website /api/tally/sync
 * Phase 2: GET pending Sales/Receipt posts → Import into Tally → ack
 *
 * Prerequisites:
 * 1. TallyPrime → Enable HTTP (port 9000)
 * 2. Ledgers exist: Sales, Bank (or set TALLY_*_LEDGER), parent Sundry Debtors
 * 3. MAP_* for stock items; TALLY_SYNC_KEY matches website
 */

const TALLY_HOST = process.env.TALLY_HOST || "http://localhost:9000";
const TALLY_COMPANY = process.env.TALLY_COMPANY || "TT Enterprises";
const SYNC_URL = process.env.SYNC_URL || "http://localhost:3000/api/tally/sync";
const SYNC_KEY = process.env.TALLY_SYNC_KEY || "tt-enterprises-tally-dev-key";
const POLL_SECONDS = Number(process.env.POLL_SECONDS || 300);
const SALES_LEDGER = process.env.TALLY_SALES_LEDGER || "Sales";
const BANK_LEDGER = process.env.TALLY_BANK_LEDGER || "Bank";
const PARTY_PARENT = process.env.TALLY_PARTY_PARENT || "Sundry Debtors";

const once = process.argv.includes("--once");

function postsUrl() {
  if (process.env.POSTS_URL) return process.env.POSTS_URL.replace(/\/$/, "");
  try {
    const u = new URL(SYNC_URL);
    u.pathname = u.pathname.replace(/\/sync\/?$/, "/posts");
    if (!u.pathname.endsWith("/posts")) {
      u.pathname = "/api/tally/posts";
    }
    return u.toString().replace(/\/$/, "");
  } catch {
    return "http://localhost:3000/api/tally/posts";
  }
}

function ackUrl() {
  return `${postsUrl()}/ack`;
}

function buildMappings() {
  /** @type {{ tallyItemId: string, productId: string, variationId?: string }[]} */
  const maps = [];
  for (const [key, value] of Object.entries(process.env)) {
    if (!key.startsWith("MAP_") || !value) continue;
    const tallyItemId = key.slice(4);
    const [productId, variationId] = String(value).split(":");
    if (!productId) continue;
    maps.push({ tallyItemId, productId, variationId: variationId || undefined });
  }
  return maps;
}

function escapeXml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function tallyDate(isoDate) {
  // YYYY-MM-DD → YYYYMMDD
  return String(isoDate || "").replace(/-/g, "").slice(0, 8);
}

function stockRequestXml(itemName) {
  return `<ENVELOPE>
 <HEADER>
  <VERSION>1</VERSION>
  <TALLYREQUEST>Export</TALLYREQUEST>
  <TYPE>Data</TYPE>
  <ID>Stock Item</ID>
 </HEADER>
 <BODY>
  <DESC>
   <STATICVARIABLES>
    <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
    <SVCURRENTCOMPANY>${escapeXml(TALLY_COMPANY)}</SVCURRENTCOMPANY>
    <STOCKITEMNAME>${escapeXml(itemName)}</STOCKITEMNAME>
   </STATICVARIABLES>
  </DESC>
 </BODY>
</ENVELOPE>`;
}

function ledgerCreateXml(partyName) {
  return `<ENVELOPE>
 <HEADER>
  <VERSION>1</VERSION>
  <TALLYREQUEST>Import</TALLYREQUEST>
  <TYPE>Data</TYPE>
  <ID>All Masters</ID>
 </HEADER>
 <BODY>
  <DESC>
   <STATICVARIABLES>
    <SVCURRENTCOMPANY>${escapeXml(TALLY_COMPANY)}</SVCURRENTCOMPANY>
   </STATICVARIABLES>
  </DESC>
  <DATA>
   <TALLYMESSAGE>
    <LEDGER NAME="${escapeXml(partyName)}" ACTION="Create">
     <NAME.LIST>
      <NAME>${escapeXml(partyName)}</NAME>
     </NAME.LIST>
     <PARENT>${escapeXml(PARTY_PARENT)}</PARENT>
     <ISBILLWISEON>Yes</ISBILLWISEON>
    </LEDGER>
   </TALLYMESSAGE>
  </DATA>
 </BODY>
</ENVELOPE>`;
}

/**
 * Simple non-GST accounting Sales: Dr Party, Cr Sales.
 * @param {{ remoteId: string, partyName: string, amount: number, date: string, narration: string }} post
 */
function salesVoucherXml(post) {
  const amt = Number(post.amount).toFixed(2);
  const date = tallyDate(post.date);
  return `<ENVELOPE>
 <HEADER>
  <VERSION>1</VERSION>
  <TALLYREQUEST>Import</TALLYREQUEST>
  <TYPE>Data</TYPE>
  <ID>Vouchers</ID>
 </HEADER>
 <BODY>
  <DESC>
   <STATICVARIABLES>
    <SVCURRENTCOMPANY>${escapeXml(TALLY_COMPANY)}</SVCURRENTCOMPANY>
   </STATICVARIABLES>
  </DESC>
  <DATA>
   <TALLYMESSAGE>
    <VOUCHER REMOTEID="${escapeXml(post.remoteId)}" VCHTYPE="Sales" ACTION="Create" OBJVIEW="Accounting Voucher View">
     <DATE>${date}</DATE>
     <NARRATION>${escapeXml(post.narration)}</NARRATION>
     <VOUCHERTYPENAME>Sales</VOUCHERTYPENAME>
     <VOUCHERNUMBER>${escapeXml(post.remoteId)}</VOUCHERNUMBER>
     <PARTYLEDGERNAME>${escapeXml(post.partyName)}</PARTYLEDGERNAME>
     <PERSISTEDVIEW>Accounting Voucher View</PERSISTEDVIEW>
     <ALLLEDGERENTRIES.LIST>
      <LEDGERNAME>${escapeXml(post.partyName)}</LEDGERNAME>
      <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
      <AMOUNT>-${amt}</AMOUNT>
     </ALLLEDGERENTRIES.LIST>
     <ALLLEDGERENTRIES.LIST>
      <LEDGERNAME>${escapeXml(SALES_LEDGER)}</LEDGERNAME>
      <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
      <AMOUNT>${amt}</AMOUNT>
     </ALLLEDGERENTRIES.LIST>
    </VOUCHER>
   </TALLYMESSAGE>
  </DATA>
 </BODY>
</ENVELOPE>`;
}

/**
 * Simple Receipt: Dr Bank, Cr Party.
 * @param {{ remoteId: string, partyName: string, amount: number, date: string, narration: string }} post
 */
function receiptVoucherXml(post) {
  const amt = Number(post.amount).toFixed(2);
  const date = tallyDate(post.date);
  return `<ENVELOPE>
 <HEADER>
  <VERSION>1</VERSION>
  <TALLYREQUEST>Import</TALLYREQUEST>
  <TYPE>Data</TYPE>
  <ID>Vouchers</ID>
 </HEADER>
 <BODY>
  <DESC>
   <STATICVARIABLES>
    <SVCURRENTCOMPANY>${escapeXml(TALLY_COMPANY)}</SVCURRENTCOMPANY>
   </STATICVARIABLES>
  </DESC>
  <DATA>
   <TALLYMESSAGE>
    <VOUCHER REMOTEID="${escapeXml(post.remoteId)}" VCHTYPE="Receipt" ACTION="Create" OBJVIEW="Accounting Voucher View">
     <DATE>${date}</DATE>
     <NARRATION>${escapeXml(post.narration)}</NARRATION>
     <VOUCHERTYPENAME>Receipt</VOUCHERTYPENAME>
     <VOUCHERNUMBER>${escapeXml(post.remoteId)}</VOUCHERNUMBER>
     <PARTYLEDGERNAME>${escapeXml(post.partyName)}</PARTYLEDGERNAME>
     <PERSISTEDVIEW>Accounting Voucher View</PERSISTEDVIEW>
     <ALLLEDGERENTRIES.LIST>
      <LEDGERNAME>${escapeXml(BANK_LEDGER)}</LEDGERNAME>
      <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
      <AMOUNT>-${amt}</AMOUNT>
     </ALLLEDGERENTRIES.LIST>
     <ALLLEDGERENTRIES.LIST>
      <LEDGERNAME>${escapeXml(post.partyName)}</LEDGERNAME>
      <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
      <AMOUNT>${amt}</AMOUNT>
     </ALLLEDGERENTRIES.LIST>
    </VOUCHER>
   </TALLYMESSAGE>
  </DATA>
 </BODY>
</ENVELOPE>`;
}

function parseQtyPair(text) {
  // e.g. "5.000 Bundle = 210.000 kg" or "210.000 kg = 5 Bundle"
  const dual = String(text).match(
    /(-?[\d.]+)\s*([A-Za-z%][A-Za-z%\s./-]*)?\s*=\s*(-?[\d.]+)\s*([A-Za-z%][A-Za-z%\s./-]*)?/i
  );
  if (!dual) {
    const single = String(text).match(/(-?[\d.]+)/);
    if (!single) return null;
    return { a: Number(single[1]), aUnit: "", b: null, bUnit: "" };
  }
  return {
    a: Number(dual[1]),
    aUnit: (dual[2] || "").trim(),
    b: Number(dual[3]),
    bUnit: (dual[4] || "").trim(),
  };
}

function isBundleUnit(unit) {
  return /bundle|bdl|bndl|nos|no\.?s?|pcs|pkt|pack|alt/i.test(String(unit || ""));
}

function isBaseUnit(unit) {
  return /kg|kgs|kilogram|mt|qtl|ton|pcs|pc\b|metre|meter|mtr|ltr|litre/i.test(
    String(unit || "")
  );
}

/**
 * Website stock = bundles = Tally Alt Qty.
 * stockSecondary = base unit (usually kg).
 * @returns {{ stock: number, stockSecondary?: number } | null}
 */
function parseClosingStock(xml) {
  const altUnitHint =
    (xml.match(/<ADDITIONALUNITS[^>]*>([^<]*)/i) ||
      xml.match(/<ALTERNATEUNIT[^>]*>([^<]*)/i) ||
      xml.match(/<REPORTINGUQC[^>]*>([^<]*)/i) ||
      [])[1] || "";
  const baseUnitHint =
    (xml.match(/<BASEUNITS[^>]*>([^<]*)/i) ||
      xml.match(/<DENOMINATORUNITS[^>]*>([^<]*)/i) ||
      [])[1] || "";

  const balanceText =
    (xml.match(/<CLOSINGBALANCE[^>]*>([^<]+)/i) ||
      xml.match(/<CLOSINGSTOCK[^>]*>([^<]+)/i) ||
      xml.match(/<ACTUALQTY[^>]*>([^<]+)/i) ||
      [])[1] || "";

  const pair = parseQtyPair(balanceText);
  if (!pair) return null;

  if (pair.b == null || Number.isNaN(pair.b)) {
    // Single qty — treat as Alt Qty (bundles) per hybrid rule
    return { stock: pair.a, stockSecondary: undefined };
  }

  let bundleQty = null;
  let baseQty = null;

  const aIsBundle = isBundleUnit(pair.aUnit) || isBundleUnit(altUnitHint);
  const bIsBundle = isBundleUnit(pair.bUnit) || isBundleUnit(altUnitHint);
  const aIsBase = isBaseUnit(pair.aUnit) || isBaseUnit(baseUnitHint);
  const bIsBase = isBaseUnit(pair.bUnit) || isBaseUnit(baseUnitHint);

  if (aIsBundle && !bIsBundle) {
    bundleQty = pair.a;
    baseQty = pair.b;
  } else if (bIsBundle && !aIsBundle) {
    bundleQty = pair.b;
    baseQty = pair.a;
  } else if (aIsBase && !bIsBase) {
    baseQty = pair.a;
    bundleQty = pair.b;
  } else if (bIsBase && !aIsBase) {
    baseQty = pair.b;
    bundleQty = pair.a;
  } else {
    // Ambiguous dual: Tally often prints "Alt = Base" or "Base = Alt".
    // Default: second number is base (kg), first is alt (bundles) when units unclear.
    if (isBundleUnit(altUnitHint) || !isBaseUnit(pair.aUnit)) {
      bundleQty = pair.a;
      baseQty = pair.b;
    } else {
      baseQty = pair.a;
      bundleQty = pair.b;
    }
  }

  if (bundleQty == null || Number.isNaN(bundleQty)) return null;
  return {
    stock: bundleQty,
    stockSecondary:
      baseQty != null && !Number.isNaN(baseQty) ? baseQty : undefined,
  };
}

function tallyImportSucceeded(xml) {
  const text = String(xml || "");
  if (/CREATED|ALTERED|COMBINED/i.test(text)) return true;
  // Duplicate remote id / already exists — treat as success (idempotent)
  if (/already exists|duplicate|REMOTEID/i.test(text) && !/LINEERROR|ERROR/i.test(text)) {
    return true;
  }
  if (/<LINEERROR/i.test(text) || /<ERROR/i.test(text)) return false;
  // Some Tally builds return empty / RESPONSE without CREATED
  if (/<RESPONSE/i.test(text) && !/ERROR|LINEERROR/i.test(text)) return true;
  return false;
}

async function postToTally(xml) {
  const res = await fetch(TALLY_HOST, {
    method: "POST",
    headers: { "Content-Type": "application/xml" },
    body: xml,
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Tally HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  return text;
}

async function fetchStockFromTally(itemName) {
  const xml = await postToTally(stockRequestXml(itemName));
  const parsed = parseClosingStock(xml);
  if (!parsed || Number.isNaN(parsed.stock)) {
    console.warn(`Could not parse stock for ${itemName}; using 0`);
    return { stock: 0, stockSecondary: undefined };
  }
  return parsed;
}

async function ensurePartyLedger(partyName) {
  try {
    await postToTally(ledgerCreateXml(partyName));
  } catch (err) {
    // Create may fail if ledger already exists — continue
    console.warn(`Party ledger ensure ${partyName}:`, err.message);
  }
}

/**
 * @param {{ id: string, kind: string, remoteId: string, partyName: string, amount: number, date: string, narration: string }} post
 */
async function importPost(post) {
  await ensurePartyLedger(post.partyName);
  const xml =
    post.kind === "receipt" ? receiptVoucherXml(post) : salesVoucherXml(post);
  const response = await postToTally(xml);
  if (!tallyImportSucceeded(response)) {
    const snippet = response.replace(/\s+/g, " ").slice(0, 300);
    throw new Error(`Tally rejected ${post.remoteId}: ${snippet || "unknown"}`);
  }
  return response;
}

async function ackPost(id, ok, error) {
  const res = await fetch(ackUrl(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-tally-sync-key": SYNC_KEY,
    },
    body: JSON.stringify({ id, ok, error: error || undefined }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(json.error || `Ack HTTP ${res.status}`);
  }
  return json;
}

async function pushPendingPosts() {
  const url = `${postsUrl()}?status=pending`;
  const res = await fetch(url, {
    headers: { "x-tally-sync-key": SYNC_KEY },
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(json.error || `Posts HTTP ${res.status}`);
  }
  const posts = Array.isArray(json.posts) ? json.posts : [];
  console.log(`Pending Tally posts: ${posts.length}`);

  for (const post of posts) {
    try {
      await importPost(post);
      await ackPost(post.id, true);
      console.log(`POSTED ${post.kind} ${post.remoteId} ₹${post.amount}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`FAIL ${post.remoteId}:`, msg);
      try {
        await ackPost(post.id, false, msg);
      } catch (ackErr) {
        console.error(`Ack failed for ${post.id}:`, ackErr.message);
      }
    }
  }
}

async function syncStockOnce() {
  const maps = buildMappings();
  if (!maps.length) {
    console.log(
      "No MAP_* entries found. Add mappings in .env, e.g.\nMAP_SN-50-3M=prod_shade_net_50:var_sn_3m"
    );
  }

  const items = [];
  for (const m of maps) {
    try {
      const qty = await fetchStockFromTally(m.tallyItemId);
      items.push({
        productId: m.productId,
        variationId: m.variationId,
        tallyItemId: m.tallyItemId,
        stock: qty.stock,
        stockSecondary: qty.stockSecondary,
      });
      console.log(
        `OK ${m.tallyItemId} → bundles(alt)=${qty.stock}` +
          (qty.stockSecondary != null ? ` kg/base=${qty.stockSecondary}` : "")
      );
    } catch (err) {
      console.error(`FAIL ${m.tallyItemId}:`, err.message);
    }
  }

  const res = await fetch(SYNC_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-tally-sync-key": SYNC_KEY,
    },
    body: JSON.stringify({ items }),
  });
  const json = await res.json();
  console.log("Website stock response:", json);
  return json;
}

async function syncOnce() {
  await syncStockOnce();
  try {
    await pushPendingPosts();
  } catch (err) {
    console.error("Posts cycle error:", err.message);
  }
}

async function main() {
  console.log("TT Enterprises · TallyPrime bridge (stock + vouchers)");
  console.log(`Company: ${TALLY_COMPANY}`);
  console.log(`Tally: ${TALLY_HOST}`);
  console.log(`Stock sync: ${SYNC_URL}`);
  console.log(`Posts: ${postsUrl()}`);
  console.log(`Ledgers: Sales=${SALES_LEDGER} Bank=${BANK_LEDGER} Parent=${PARTY_PARENT}`);

  if (once) {
    await syncOnce();
    return;
  }

  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      await syncOnce();
    } catch (err) {
      console.error("Sync cycle error:", err.message);
    }
    await new Promise((r) => setTimeout(r, POLL_SECONDS * 1000));
  }
}

main();
