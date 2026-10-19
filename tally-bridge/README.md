# T T Enterprises · TallyPrime Bridge

This small program runs on the **office PC where TallyPrime is installed**. Each cycle it copies every stock item and every ledger onto the website as raw data, then posts queued website sales (and any new dealer ledgers) back into Tally.

Links are made on the website: **Admin → Tally**. The bridge does not create products.

## One-time setup

1. Open **TallyPrime**.
2. Enable HTTP/ODBC connectivity (port **9000** is common).
3. Copy `.env.example` to `.env`.
4. Set your exact company name: `TALLY_COMPANY=...`
5. Point `SYNC_URL` at the live site, for example
   `https://app.ttenterprises.shop/api/tally/sync`.
   Use the same `TALLY_SYNC_KEY` as the website.
6. In a terminal in this folder:

```bash
npm install
npm run once
```

7. On the website open **Admin → Tally**.
   - **Items**: link each Tally stock item to a product or size, or create the product from that row.
   - **Ledgers**: link each Sundry Debtor / Creditor to a dealer.
   - New names that appear on a later cycle show up as **New / unlinked**. Ignore raw material, banks and expenses.
   - A confirmed order waits in **Sales queue** until its dealer and every line have a link.

Each later cycle:

- sends the full item list (name, GUID, unit, group, closing qty) and the full ledger list
- marks anything missing from Tally, without deleting the link
- pulls `/api/tally/pending` — ledger masters first, then sales — and acknowledges `/api/tally/ack`

## If you cannot run the bridge yet

In Tally: **Display → List of Accounts**, export Stock Items and Ledgers to Excel or CSV, then upload each file on **Admin → Tally → Import**. That fills the same raw lists. Stock quantities still need the bridge.

## Continuous sync

```bash
npm start
```

Polls every `POLL_SECONDS` (default 300).

## Security

Set a strong `TALLY_SYNC_KEY` in both the bridge `.env` and the website `.env.local`.
