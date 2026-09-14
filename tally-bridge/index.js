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

async function syncOnce() {
  const maps = buildMappings();
  if (!maps.length) {
    console.log(
      "No MAP_* entries found. Add mappings in .env, e.g.\nMAP_SN-50-3M=prod_shade_net_50:var_sn_3m"
    );
    // Still post an empty validated heartbeat
  }

  const items = [];
  for (const m of maps) {
    try {
      const stock = await fetchStockFromTally(m.tallyItemId);
      items.push({
        productId: m.productId,
        variationId: m.variationId,
        tallyItemId: m.tallyItemId,
        stock,
      });
      console.log(`OK ${m.tallyItemId} → ${stock}`);
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
  console.log("Website response:", json);
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
