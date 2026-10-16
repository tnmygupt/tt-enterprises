import "dotenv/config";

/**
 * TallyPrime stock bridge for T T Enterprises
 * -------------------------------------------
 * Runs on the office PC where TallyPrime is installed.
 * Reads stock via Tally HTTP XML and POSTs to the website sync API.
 *
 * Prerequisites:
 * 1. TallyPrime → Gateway of Tally → F1 (Help) / Connectivity / Enable ODBC / HTTP
 * 2. Set company name in .env
 * 3. Map stock items using MAP_* env vars
 */

const TALLY_HOST = process.env.TALLY_HOST || "http://localhost:9000";
const TALLY_COMPANY = process.env.TALLY_COMPANY || "TT Enterprises";
const SYNC_URL = process.env.SYNC_URL || "http://localhost:3000/api/tally/sync";
const SYNC_KEY = process.env.TALLY_SYNC_KEY || "tt-enterprises-tally-dev-key";
const POLL_SECONDS = Number(process.env.POLL_SECONDS || 300);
const once = process.argv.includes("--once");

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

function escapeXml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function parseClosingStock(xml) {
  const match =
    xml.match(/<CLOSINGBALANCE[^>]*>(-?[\d.]+)/i) ||
    xml.match(/<CLOSINGSTOCK[^>]*>(-?[\d.]+)/i) ||
    xml.match(/<ACTUALQTY[^>]*>.*?(-?[\d.]+)/i);
  if (!match) return null;
  return Number(match[1]);
}

async function fetchStockFromTally(itemName) {
  const res = await fetch(TALLY_HOST, {
    method: "POST",
    headers: { "Content-Type": "application/xml" },
    body: stockRequestXml(itemName),
  });
  if (!res.ok) {
    throw new Error(`Tally HTTP ${res.status} for ${itemName}`);
  }
  const xml = await res.text();
  const stock = parseClosingStock(xml);
  if (stock == null || Number.isNaN(stock)) {
    // Demo fallback when Tally is offline: keep previous-like random-stable stock
    console.warn(`Could not parse stock for ${itemName}; using 0`);
    return 0;
  }
  return stock;
}

function apiUrl(path) {
  const url = new URL(SYNC_URL);
  url.pathname = path;
  url.search = "";
  return url.toString();
}

function tallyHeaders() {
  return {
    "Content-Type": "application/json",
    "x-tally-sync-key": SYNC_KEY,
  };
}

function stockCollectionXml() {
  return `<ENVELOPE>
 <HEADER>
  <VERSION>1</VERSION>
  <TALLYREQUEST>Export</TALLYREQUEST>
  <TYPE>Collection</TYPE>
  <ID>TTStockItems</ID>
 </HEADER>
 <BODY>
  <DESC>
   <STATICVARIABLES>
    <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
    <SVCURRENTCOMPANY>${escapeXml(TALLY_COMPANY)}</SVCURRENTCOMPANY>
   </STATICVARIABLES>
   <TDL>
    <TDLMESSAGE>
     <COLLECTION NAME="TTStockItems" ISMODIFY="No">
      <TYPE>Stock Item</TYPE>
      <FETCH>Name, ClosingBalance</FETCH>
     </COLLECTION>
    </TDLMESSAGE>
   </TDL>
  </DESC>
 </BODY>
</ENVELOPE>`;
}

function parseStockCollection(xml) {
  const items = [];
  const re = /<STOCKITEM\b([^>]*)>([\s\S]*?)<\/STOCKITEM>/gi;
  let match;
  while ((match = re.exec(xml))) {
    const name =
      match[1].match(/NAME="([^"]+)"/i)?.[1] ||
      match[2].match(/<NAME>([^<]*)<\/NAME>/i)?.[1];
    if (!name) continue;
    const stock = parseClosingStock(match[2]);
    items.push({
      name: name.replaceAll("&amp;", "&").replaceAll("&quot;", '"'),
      stock: stock == null || Number.isNaN(stock) ? 0 : stock,
    });
  }
  return items;
}

async function fetchAllStock() {
  const res = await fetch(TALLY_HOST, {
    method: "POST",
    headers: { "Content-Type": "application/xml" },
    body: stockCollectionXml(),
  });
  if (!res.ok) throw new Error(`Tally HTTP ${res.status} for stock list`);
  const xml = await res.text();
  return parseStockCollection(xml);
}

function saleVoucherXml(post) {
  const date = String(post.date || "").replaceAll("-", "");
  const lines = Array.isArray(post.lines) ? post.lines : [];
  const inventory = lines
    .map((line) => {
      const item = line.tallyItemId || line.name || line.sku || "Item";
      const qty = Number(line.qty) || 0;
      const amount = Number(line.amount) || 0;
      const rate = Number(line.rate) || 0;
      return `<ALLINVENTORYENTRIES.LIST>
        <STOCKITEMNAME>${escapeXml(item)}</STOCKITEMNAME>
        <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
        <RATE>${rate}</RATE>
        <AMOUNT>${amount}</AMOUNT>
        <ACTUALQTY>${qty}</ACTUALQTY>
        <BILLEDQTY>${qty}</BILLEDQTY>
       </ALLINVENTORYENTRIES.LIST>`;
    })
    .join("");
  const amount = Number(post.amount) || 0;
  return `<ENVELOPE>
 <HEADER>
  <TALLYREQUEST>Import Data</TALLYREQUEST>
 </HEADER>
 <BODY>
  <IMPORTDATA>
   <REQUESTDESC>
    <REPORTNAME>Vouchers</REPORTNAME>
    <STATICVARIABLES>
     <SVCURRENTCOMPANY>${escapeXml(TALLY_COMPANY)}</SVCURRENTCOMPANY>
    </STATICVARIABLES>
   </REQUESTDESC>
   <REQUESTDATA>
    <TALLYMESSAGE xmlns:UDF="TallyUDF">
     <VOUCHER REMOTEID="${escapeXml(post.remoteId)}" VCHTYPE="Sales" ACTION="Create" OBJVIEW="Invoice Voucher View">
      <DATE>${escapeXml(date)}</DATE>
      <VOUCHERTYPENAME>Sales</VOUCHERTYPENAME>
      <PARTYLEDGERNAME>${escapeXml(post.partyName)}</PARTYLEDGERNAME>
      <VOUCHERNUMBER>${escapeXml(post.orderNumber)}</VOUCHERNUMBER>
      <REFERENCE>${escapeXml(post.orderNumber)}</REFERENCE>
      <NARRATION>${escapeXml(post.narration || "")}</NARRATION>
      ${inventory}
      <LEDGERENTRIES.LIST>
       <LEDGERNAME>${escapeXml(post.partyName)}</LEDGERNAME>
       <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
       <ISPARTYLEDGER>Yes</ISPARTYLEDGER>
       <AMOUNT>${-Math.abs(amount)}</AMOUNT>
      </LEDGERENTRIES.LIST>
     </VOUCHER>
    </TALLYMESSAGE>
   </REQUESTDATA>
  </IMPORTDATA>
 </BODY>
</ENVELOPE>`;
}

function assertTallyImport(xml) {
  const line = xml.match(/<LINEERROR>([^<]*)/i);
  if (line) throw new Error(line[1] || "Tally line error");
  const errors = xml.match(/<ERRORS>(\d+)/i);
  if (errors && Number(errors[1]) > 0) {
    throw new Error("Tally import reported errors");
  }
  if (/already exists|duplicate/i.test(xml)) return;
  const created = xml.match(/<CREATED>(\d+)/i);
  const altered = xml.match(/<ALTERED>(\d+)/i);
  const createdN = created ? Number(created[1]) : 0;
  const alteredN = altered ? Number(altered[1]) : 0;
  if (createdN + alteredN < 1) {
    throw new Error("Tally did not create the sales voucher");
  }
}

async function pushStock(items) {
  const res = await fetch(SYNC_URL, {
    method: "POST",
    headers: tallyHeaders(),
    body: JSON.stringify({ items }),
  });
  const json = await res.json();
  console.log("Stock response:", json);
  return json;
}

async function pullAndPostSales() {
  const res = await fetch(apiUrl("/api/tally/pending"), {
    headers: { "x-tally-sync-key": SYNC_KEY },
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || `Pending HTTP ${res.status}`);
  const posts = Array.isArray(json.posts) ? json.posts : [];
  console.log(`Sales waiting: ${posts.length}`);
  for (const post of posts) {
    try {
      const tallyRes = await fetch(TALLY_HOST, {
        method: "POST",
        headers: { "Content-Type": "application/xml" },
        body: saleVoucherXml(post),
      });
      const xml = await tallyRes.text();
      if (!tallyRes.ok) throw new Error(`Tally HTTP ${tallyRes.status}`);
      assertTallyImport(xml);
      await fetch(apiUrl("/api/tally/ack"), {
        method: "POST",
        headers: tallyHeaders(),
        body: JSON.stringify({ remoteId: post.remoteId, status: "posted" }),
      });
      console.log(`Posted ${post.remoteId}`);
    } catch (err) {
      console.error(`Sale ${post.remoteId}:`, err.message);
      await fetch(apiUrl("/api/tally/ack"), {
        method: "POST",
        headers: tallyHeaders(),
        body: JSON.stringify({
          remoteId: post.remoteId,
          status: "failed",
          error: err.message,
        }),
      }).catch(() => {});
    }
  }
}

async function syncOnce() {
  const maps = buildMappings();
  let items = [];
  try {
    const all = await fetchAllStock();
    if (all.length) {
      const byName = new Map(maps.map((m) => [m.tallyItemId.toLowerCase(), m]));
      items = all.map((row) => {
        const mapped = byName.get(row.name.toLowerCase());
        return {
          tallyItemId: row.name,
          name: row.name,
          sku: row.name,
          stock: row.stock,
          productId: mapped?.productId,
          variationId: mapped?.variationId,
        };
      });
      console.log(`Tally stock items: ${items.length}`);
    }
  } catch (err) {
    console.warn("Stock list failed, using MAP_* only:", err.message);
  }

  if (!items.length) {
    if (!maps.length) {
      console.log(
        "No stock list and no MAP_* entries. Example:\nMAP_SN-50-3M=prod_shade_net_50:var_sn_3m"
      );
    }
    for (const m of maps) {
      try {
        const stock = await fetchStockFromTally(m.tallyItemId);
        items.push({
          productId: m.productId,
          variationId: m.variationId,
          tallyItemId: m.tallyItemId,
          name: m.tallyItemId,
          stock,
        });
        console.log(`OK ${m.tallyItemId} → ${stock}`);
      } catch (err) {
        console.error(`FAIL ${m.tallyItemId}:`, err.message);
      }
    }
  }

  const json = await pushStock(items);
  try {
    await pullAndPostSales();
  } catch (err) {
    console.error("Sales pull failed:", err.message);
  }
  return json;
}

async function main() {
  console.log("T T Enterprises · TallyPrime bridge");
  console.log(`Company: ${TALLY_COMPANY}`);
  console.log(`Tally: ${TALLY_HOST}`);
  console.log(`Sync: ${SYNC_URL}`);

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
