# TT Enterprises · TallyPrime Bridge

Runs on the **office PC where TallyPrime is installed**.

**Hybrid books:** Tally remains the legal books. The website is for dealer ops, mirrors stock, and queues **simple non-GST Sales / Receipt** vouchers for this bridge to import.

| Direction | What |
|-----------|------|
| Tally → website | Stock: **Alt Qty (Bundle) → website bundles**; base unit (kg) → `stockSecondary` |
| Website → Tally | Sales + Receipt accounting vouchers (Phase 2, no GST / no inventory lines) |

## Units (important)

In Tally stock item setup:

- **Base unit** = kg (or pcs) → website `stockSecondary`
- **Alternate / Additional unit** = Bundle → website `stock` (what dealers see as pack stock)

Bridge parses `CLOSINGBALANCE` dual forms like `5 Bundle = 210 kg`.

## One-time setup

1. Open **TallyPrime** and enable HTTP connectivity (port **9000**).
2. Ensure ledgers exist (exact names, or set env overrides):
   - `Sales` (income)
   - `Bank` (bank account)
   - Parent group `Sundry Debtors` for party ledgers
3. Copy `.env.example` to `.env`.
4. Set company, live URLs, and sync key:

```env
TALLY_COMPANY=TT Enterprises
SYNC_URL=https://tanmayphotos.space/api/tally/sync
POSTS_URL=https://tanmayphotos.space/api/tally/posts
TALLY_SYNC_KEY=<same-as-website-TALLY_SYNC_KEY>
TALLY_SALES_LEDGER=Sales
TALLY_BANK_LEDGER=Bank
TALLY_PARTY_PARENT=Sundry Debtors
```

5. Map stock items (Phase 1):

```env
MAP_TRP-HDPE-120-12x18=prod_tarpaulin_hdpe:var_trp_12x18
MAP_SN-50-3M=prod_shade_net_50:var_sn_3m
```

Names must match **Admin → Tally → Tally item ID**.

6. Install and test:

```bash
npm install
npm run once
```

Each cycle: push stock to the site, then pull pending posts and import Sales/Receipt into Tally, then ack.

## Continuous sync

```bash
npm start
```

Polls every `POLL_SECONDS` (default 300). Prefer Windows Task Scheduler at logon.

## Phase 2 voucher behaviour

- **Sale** queued when final bill is uploaded on the website (`WEB-SALE-{orderNumber}`).
- **Receipt** queued when payment is verified (`WEB-RCPT-{orderNumber}`).
- Amounts are accounting-only (party ↔ Sales / Bank). **No GST tax lines**, **no stock item allocations**.
- Party ledger is created under `TALLY_PARTY_PARENT` if missing.
- Re-import with the same `REMOTEID` is treated as success (idempotent).
- Failed posts show in **Admin → Tally** with Retry.

## Security

| Key | Where | Purpose |
|-----|--------|---------|
| `TALLY_SYNC_KEY` | Bridge + website (server) | Stock POST + posts GET/ack |
| `TALLY_READ_KEY` / `NEXT_PUBLIC_TALLY_READ_KEY` | Website only | Staff browsers pull stock via `/api/tally/latest` |

Never put `TALLY_SYNC_KEY` in `NEXT_PUBLIC_*`.

## Checklist

- [ ] Tally HTTP enabled  
- [ ] `Sales` / `Bank` (or custom env names) exist in Tally  
- [ ] Live `SYNC_URL` / `POSTS_URL` + matching `TALLY_SYNC_KEY`  
- [ ] `MAP_*` for sellable SKUs  
- [ ] `npm run once` succeeds; Admin sync + post queue update  
- [ ] After a live bill + payment verify, posts move pending → posted  
