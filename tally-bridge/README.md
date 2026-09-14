# T T Enterprises · TallyPrime Bridge

This small program runs on the **office PC where TallyPrime is installed**. It reads stock and sends it to the website.

## One-time setup (no coding needed)

1. Open **TallyPrime**.
2. Enable HTTP/ODBC connectivity (port **9000** is common).
3. Copy `.env.example` to `.env`.
4. Set your exact company name: `TALLY_COMPANY=...`
5. Map each Tally stock item to a website product:

```env
MAP_TRP-HDPE-120-12x18=prod_tarpaulin_hdpe:var_trp_12x18
MAP_SN-50-3M=prod_shade_net_50:var_sn_3m
```

6. In a terminal in this folder:

```bash
npm install
npm run once
```

7. Keep the website running (`npm run dev` or production). The bridge POSTs to
   `/api/tally/sync` — stock is saved server-side and **auto-applied** in browsers
   within about a minute. Manual paste in **Admin → Tally** still works as backup.

## Continuous sync

```bash
npm start
```

Polls every `POLL_SECONDS` (default 300).

## Security

Set a strong `TALLY_SYNC_KEY` in both the bridge `.env` and the website `.env.local`.
