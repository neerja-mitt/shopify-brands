# Build Plan

Phase-by-phase sequencing for the Grape × Shopify integration. Mirrors
[`SPEC.md` §6](SPEC.md). Each phase is independently testable. **Phase 1 must be
proven first** — everything depends on the mapping table being correct.

Legend: ☐ not started · ◑ in progress · ☑ done.

**Implemented so far** (fully unit-tested — no live DB or Shopify credentials
required to run the suite):

- Sellable-qty formula — `src/sync/sellable.ts` (§5.2)
- Visibility rules — `src/sync/visibility.ts` (§5.3)
- HMAC webhook verification — `src/shopify/webhooks.ts` `verifyHmac` (§4.5)
- Token encryption at rest (AES-256-GCM) — `src/crypto/tokens.ts` (§4.3)
- Persistence layer — repository ports (`src/db/repositories.ts`) + fully-tested
  in-memory adapter (`src/db/memory.ts`, encrypts tokens at its boundary).
  Postgres adapter (`src/db/postgres.ts`) is a documented stub. (§5.1)

Run `npm test` (31 tests) and `npm run typecheck`.

---

## Phase 0 — App & OAuth setup

| # | Task | File(s) | Status |
|---|---|---|---|
| 0.1 | Create public (unlisted) app in Partner dashboard; configure scopes `read_products`, `read_inventory`, `write_inventory`, `read_locations` | _(external — Partner dashboard)_; runbook: [`PARTNER_SETUP.md`](PARTNER_SETUP.md) + [`shopify.app.toml`](../shopify.app.toml) | ☐ your action — step-by-step runbook + config-as-code provided |
| 0.2 | OAuth install-by-link flow: authorize URL + callback | `src/shopify/oauth.ts` | ☐ |
| 0.3 | On install, persist shop domain, **encrypted** token, primary `location_id` (via `read_locations`), status=active | `src/shopify/oauth.ts`, `src/db/` | ◑ token crypto + store repository (port + in-memory adapter) done & tested; Postgres adapter + install-time wiring pending |
| 0.4 | Register mandatory webhooks (`app/uninstalled`, `customers/data_request`, `customers/redact`, `shop/redact`) | `src/shopify/oauth.ts`, `src/shopify/webhooks.ts` | ☐ |
| 0.5 | HMAC verification on every webhook | `src/shopify/webhooks.ts` | ◑ `verifyHmac` done + tested; per-route wiring pending |

## Phase 1 — Catalogue sync (PULL) — build & test alone first

| # | Task | File(s) | Status |
|---|---|---|---|
| 1.1 | `merchant_product_map` table; key off `shopify_variant_id` | `src/db/schema.sql`, `src/db/` | ◑ DDL + repository port + in-memory adapter done & tested (PK + grape/inventory lookups); Postgres adapter pending |
| 1.2 | Initial import via GraphQL Admin API: paginate products + variants + inventory + price | `src/sync/catalogue.ts`, `src/shopify/client.ts` | ☐ |
| 1.3 | Run through auto-tagging/styling pipeline → auto-publish | `src/sync/catalogue.ts` | ☐ |
| 1.4 | Apply Shopify-state → visibility rules (§5.3) | `src/sync/catalogue.ts`, `src/sync/visibility.ts` | ◑ `resolveVisibility` done + tested; applied during import pending |
| 1.5 | Functional webhooks (`products/update`, `products/delete`, `inventory_levels/update`) | `src/shopify/webhooks.ts` | ☐ |
| 1.6 | Per-store rate-limit queue | `src/safety/rateLimitQueue.ts` | ☐ |

## Phase 2 — Inventory writeback (PUSH)

| # | Task | File(s) | Status |
|---|---|---|---|
| 2.1 | On Grape order confirmed → `inventoryAdjustQuantities` with **negative delta** (relative adjust, never set) | `src/sync/inventory.ts` | ☐ |
| 2.2 | Failure handling: retry on rate-limit, log on hard failure, flag for nightly reconcile. **No restore logic.** | `src/sync/inventory.ts` | ☐ |

## Phase 3 — Grape Merchant portal (standalone web app)

| # | Task | File(s) | Status |
|---|---|---|---|
| 3.1 | Auth + merchant accounts (design system: DM Sans, purple `#7C3AED` accent, black primary CTA) | `src/portal/` | ☐ |
| 3.2 | Orders list: Grape orders for that merchant; prepaid vs COD marked; COD shows amount-to-collect | `src/portal/index.ts` | ☐ |
| 3.3 | Status actions: mark processed/shipped → write back to Grape → surface to customer | `src/portal/index.ts` | ☐ |

## Phase 4 — Safety & ops

| # | Task | File(s) | Status |
|---|---|---|---|
| 4.1 | Nightly reconcile: re-baseline `last_synced_qty`, flag drift | `src/safety/reconcile.ts` | ☐ |
| 4.2 | Oversell buffer (configurable, default 1–2 units) | `src/config/index.ts`, `src/sync/sellable.ts` | ◑ default in config + applied in `computeSellableQty`; per-variant override pending |
| 4.3 | Uninstall handling: `app/uninstalled` → mark inactive + hide catalogue | `src/shopify/webhooks.ts` | ☐ |

---

## Open items to confirm (SPEC §9)

- [ ] Auto-tagging/styling pipeline can run **unattended** on ingest (blocks 1.3).
- [ ] Default **oversell buffer** value (suggested 1–2; scaffold defaults to 2).
- [ ] Nightly reconcile time window + alert destination (scaffold: `0 3 * * *`, `DRIFT_ALERT_DESTINATION`).
- [ ] Merchant portal auth method — email/password vs magic link (blocks 3.1).

## Decisions NOT to re-litigate (SPEC §3)

No order scopes · orders live in Grape, never created in Shopify · Shopify is
source of truth for stock · writeback is relative **adjust** never set · deduct
on Grape order placed/confirmed · merchant restores RTO manually · auto-publish
everything · GraphQL Admin API.
