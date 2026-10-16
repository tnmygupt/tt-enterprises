# T T Enterprises · TallyPrime Bridge

This small program runs on the **office PC where TallyPrime is installed**. It sends stock to the website and posts queued website orders back into Tally as sales.

## One-time setup (no coding needed)

1. Open **TallyPrime**.
2. Enable HTTP/ODBC connectivity (port **9000** is common).
3. Copy `.env.example` to `.env`.
4. Set your exact company name: `TALLY_COMPANY=...`
5. Optional. Map a Tally stock item when the website name does not match it exactly:

```env
MAP_TRP-HDPE-120-12x18=prod_tarpaulin_hdpe:var_trp_12x18
MAP_SN-50-3M=prod_shade_net_50:var_sn_3m
```

Without a map, the site matches the Tally item name to a product or size SKU / exact name.

6. In a terminal in this folder:

```bash
npm install
npm run once
```

7. Point `SYNC_URL` at the live site, for example
   `https://app.ttenterprises.shop/api/tally/sync`. Each cycle:

   - reads every Tally stock item and writes it on the website
   - pulls `/api/tally/pending` and creates those sales in Tally
   - acknowledges each one at `/api/tally/ack`

   Use the same `TALLY_SYNC_KEY` on the website. Admin → Tally shows the last sync and any sale still waiting.

## Continuous sync

```bash
npm start
```

Polls every `POLL_SECONDS` (default 300).

## Security

Set a strong `TALLY_SYNC_KEY` in both the bridge `.env` and the website `.env.local`.
