# Grape × Shopify Merchant Integration

Two-way integration with third-party merchants' Shopify stores:

- **Pull in** their products, variants, prices, and inventory → auto-publish onto Grape.
- **Push back** an inventory **decrement** on every Grape sale, so the merchant's own storefront doesn't oversell.

> **Architecture in one line:** Shopify is a **data pipe** (catalogue in, inventory decrements out). Merchant-facing order management lives in a **standalone Grape portal**, not inside Shopify. We **never** create or touch orders in the merchant's Shopify store.

Full specification: [`docs/SPEC.md`](docs/SPEC.md). Phase sequencing: [`docs/BUILD_PLAN.md`](docs/BUILD_PLAN.md).

> **Status: scaffold.** This repo currently contains structure, config, the data model, and typed stubs only — **no business logic is implemented yet.** Every stub throws `Not implemented (Phase N)` and is annotated with the spec section it traces to.

## Stack

- **Node.js 20+ / TypeScript** (ESM)
- **Shopify GraphQL Admin API** via `@shopify/shopify-api` — one query pulls product + variants + inventory + price, cutting call count against rate limits.
- **Postgres** for the mapping table and store records.

## Layout

```
src/
  index.ts            App entry point (bootstrap — not wired yet)
  config/             Validated env-backed configuration
  db/
    schema.sql        Postgres DDL — stores + merchant_product_map (spec §5.1)
    index.ts          Persistence access layer (stub)
  types/              Shared domain types mirroring the data model
  shopify/
    oauth.ts          OAuth install-by-link flow (Phase 0)
    client.ts         GraphQL Admin API wrapper (Phase 1/2)
    webhooks.ts       HMAC verify + topic dispatch (Phase 0/1)
  sync/
    catalogue.ts      Catalogue pull + auto-tag/publish + visibility (Phase 1)
    inventory.ts      Inventory writeback — relative adjust only (Phase 2)
  portal/             Standalone merchant portal — orders view (Phase 3)
  safety/
    rateLimitQueue.ts Per-store throttled job queue (Phase 1)
    reconcile.ts      Nightly reconcile + drift alerting (Phase 4)
docs/
  SPEC.md             The build specification
  BUILD_PLAN.md       Phase-by-phase plan + open items
```

## Getting started

```bash
cp .env.example .env      # fill in Shopify credentials + DATABASE_URL
npm install
npm run typecheck         # type-checks clean (src + tests)
npm test                  # runs the unit suite (Node native runner)
npm run dev               # boots the (empty) skeleton
```

### What's implemented

The dependency-free correctness core is built and unit-tested (no DB or Shopify
credentials needed to run the suite):

- **Sellable-qty formula** — `src/sync/sellable.ts` (§5.2)
- **Visibility rules** — `src/sync/visibility.ts` (§5.3)
- **HMAC webhook verification** — `src/shopify/webhooks.ts` (§4.5)
- **Token encryption at rest** (AES-256-GCM) — `src/crypto/tokens.ts` (§4.3)

Everything else remains a typed `Not implemented (Phase N)` stub. See
[`docs/BUILD_PLAN.md`](docs/BUILD_PLAN.md) for live status.

## Non-negotiable rules (from the spec)

These are settled decisions baked into the design — see [`docs/SPEC.md` §3](docs/SPEC.md):

- **No order scopes.** We never read or write the merchant's Shopify orders.
- **Inventory writeback is a relative `adjust`, never an absolute `set`** — avoids clobbering a storefront sale.
- **Map off the numeric `shopify_variant_id`, never the SKU** — SKUs get edited; numeric IDs are stable.
- **Store `location_id` per merchant; never hard-code it.**
- **Access tokens are encrypted at rest.**
- **No RTO/return restore logic on our side** — the merchant adds stock back manually in Shopify.
- **Auto-publish everything** — no curation gate.
