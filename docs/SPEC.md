# Grape × Shopify Merchant Integration — Build Specification

**Status:** Ready to build
**Audience:** Engineer / Claude Code
**Last updated:** May 2026

---

## 1. Context & Goal

Grape is listing the products of third-party merchants who run their stores on Shopify. We do **not** hold their inventory. We need a two-way integration with each merchant's Shopify store:

- **Pull in:** their products, variants, prices, and inventory — auto-published onto Grape.
- **Push back:** an inventory **decrement** every time a unit sells on Grape, so the merchant's own storefront doesn't oversell.

Merchants manage the orders they receive from Grape through a **separate Grape Merchant portal** (our own web app). They do **not** manage Grape orders inside Shopify, and Grape does **not** create orders in their Shopify store.

### One-line architecture

> Shopify is a **data pipe** (catalogue in, inventory decrements out). The merchant-facing order management lives in a **standalone Grape portal**, not inside Shopify.

---

## 2. Scope

### In scope
1. Shopify OAuth app (public, unlisted) — install-by-link, one app for all merchants.
2. Catalogue sync (pull): products, variants, price, inventory → auto-publish to Grape.
3. Inventory writeback (push): decrement Shopify stock on each confirmed Grape sale.
4. Webhooks for live updates (products, inventory) and lifecycle (uninstall, compliance).
5. Standalone Grape Merchant portal: merchants view Grape orders and mark them processed/shipped.
6. Safety layer: per-store rate-limit queue, nightly reconcile, oversell buffer.

### Explicitly out of scope
- Creating or modifying orders inside the merchant's Shopify store (we never touch their Orders).
- Embedding a UI inside Shopify admin (no App Bridge / Polaris). The merchant portal is our own web app.
- RTO/return inventory restoration logic on our side — **the merchant handles add-back manually** in Shopify when a delivery fails or returns (they own logistics).
- Product curation queue — products **auto-publish** (see §5).
- Shopify App Store listing/review (app stays unlisted; install by link).

---

## 3. Key Decisions (settled — do not re-litigate)

| Decision | Choice | Reason |
|---|---|---|
| Connection model | Public app, **unlisted**, OAuth install-by-link | One credential set, scales across merchants; no App Store review needed |
| Order fulfilment | Orders live in **Grape**, managed via standalone portal | Merchants only view/mark orders; no need to touch Shopify orders |
| Shopify orders | **Never created** | We don't push into their order list |
| Inventory: source of truth | **Shopify** is source of truth for stock that exists | Merchant also sells on their own site; we only see those sales via Shopify |
| Inventory writeback | **Adjust (relative delta)**, never set absolute | Avoids overwriting a sale that happened on their storefront between read and write |
| Deduct timing | On **Grape order placed/confirmed** | Simple; safe direction |
| RTO/return restore | **Merchant adds back manually** in Shopify | They handle logistics; removes a state machine from our side |
| Product publishing | **Auto-publish everything** from Shopify | No curation gate; tagging pipeline runs on ingest |
| Sync freshness | Polling first, **webhooks as fast-follow** | Least to build first; webhooks shrink oversell window |
| API | **GraphQL Admin API** | Fewer calls (product + variants + inventory in one query) |

---

## 4. Required Shopify Setup

### 4.1 App
- Create a **public app** in the Shopify Partner dashboard. Leave it **unlisted** (do not submit for App Store review).
- Single app, single set of API credentials, used for all merchant installs.

### 4.2 OAuth scopes
Request only what's needed:
- `read_products`
- `read_inventory`
- `write_inventory`
- `read_locations`

> **No order scopes.** We never read or write the merchant's Shopify orders.

### 4.3 OAuth install flow
- Standard Shopify OAuth 2.0 authorization code flow.
- Install via a link we send each merchant during manual onboarding.
- On successful install, store **per store**:
  - `shop` domain (e.g. `merchant.myshopify.com`)
  - access token (**encrypted at rest**)
  - primary `location_id` (fetch via `read_locations` at install; store explicitly — never hard-code)
  - install timestamp, status = `active`

### 4.4 Mandatory webhooks (required even when unlisted)
- `app/uninstalled`
- `customers/data_request` (GDPR compliance)
- `customers/redact` (GDPR compliance)
- `shop/redact` (GDPR compliance)

### 4.5 Functional webhooks (fast-follow after polling works)
- `products/update`
- `products/delete`
- `inventory_levels/update`

All webhooks must verify the Shopify HMAC signature before processing.

---

## 5. Data Model

### 5.1 The mapping table (foundation — build first)

A Shopify product is a **parent** with N **variants**. Each variant has its own price and its own `inventory_item_id`. Map at the **variant** level.

**Key off Shopify's numeric `variant_id`, not the SKU string** (merchants edit SKUs; numeric IDs are stable).

`merchant_product_map`:

| Field | Source | Notes |
|---|---|---|
| `grape_listing_id` | Grape | Grape's own listing/product ID |
| `grape_variant_id` | Grape | Grape's variant ID |
| `shop_domain` | Shopify | which store |
| `shopify_product_id` | Shopify | parent product |
| `shopify_variant_id` | Shopify | **stable key** for mapping |
| `shopify_inventory_item_id` | Shopify | needed for inventory adjust |
| `location_id` | Shopify | which location stock is deducted from |
| `last_synced_qty` | Shopify | last known Shopify quantity (baseline) |
| `last_synced_price` | Shopify | last known price |
| `shopify_status` | Shopify | active / draft / archived |
| `updated_at` | system | last sync time |

### 5.2 Grape catalogue inventory — the formula

Grape's sellable quantity for a variant is:

```
grape_sellable_qty = last_synced_shopify_qty
                   − grape_orders_not_yet_reflected_in_shopify
                   − oversell_buffer
```

- We **trust Shopify's number** as the baseline at each sync.
- We subtract Grape orders that have decremented locally but whose writeback may be in flight.
- We subtract a small configurable buffer (default 1–2 units) so we never sell Shopify's last unit.

### 5.3 Shopify state → Grape visibility (strict; no human catches errors)

| Shopify state | Grape behaviour |
|---|---|
| Active + stock > buffer | Buyable |
| Draft | Hidden / not buyable |
| Archived | Hidden / not buyable |
| Deleted | Hidden / not buyable |
| Stock ≤ buffer | Not buyable (shown sold out) |

---

## 6. Build Phases

> Each phase is independently testable. **Phase 1 must be proven first** — everything depends on the mapping table being correct.

### Phase 0 — App & OAuth setup
1. Create public (unlisted) app in Partner dashboard.
2. Configure scopes: `read_products`, `read_inventory`, `write_inventory`, `read_locations`.
3. Build OAuth install flow; on install store shop domain, encrypted token, primary `location_id`, status.
4. Register mandatory webhooks: `app/uninstalled`, `customers/data_request`, `customers/redact`, `shop/redact`. Verify HMAC on all.

### Phase 1 — Catalogue sync (pull) — **build & test alone first**
5. Build `merchant_product_map` table (§5.1). Key off `shopify_variant_id`.
6. Initial import via **GraphQL Admin API**: paginate products + variants + inventory + price in batched queries.
7. Run imported products through Grape's **auto-tagging / styling pipeline**, then **auto-publish**. *(Confirm the tagging pipeline can run unattended on ingest.)*
8. Apply Shopify-state → visibility rules (§5.3).
9. Webhooks (fast-follow): `products/update`, `products/delete`, `inventory_levels/update` → keep Grape current in near-real-time.
10. Per-store rate-limit queue so multi-store syncs don't spike Shopify limits.

### Phase 2 — Inventory writeback (push)
11. On Grape order confirmed: call `inventoryAdjustQuantities` with a **negative delta** against the variant's `inventory_item_id` + `location_id`. **Relative adjust — never set absolute.**
12. Failure handling: retry on rate-limit (respect throttle), log on hard failure, flag for nightly reconcile. **No restore logic** — merchant handles RTO add-back manually in Shopify.

### Phase 3 — Grape Merchant portal (standalone web app)
13. Auth + merchant accounts. Our stack, our design system (DM Sans, brand purple `#7C3AED` as accent only, black as primary CTA).
14. Orders list: Grape orders for that merchant. **Prepaid vs COD clearly marked.** COD rows show **amount to collect**.
15. Status actions: mark **processed / shipped** → writes back to Grape order state → surfaces status to the Grape customer.

### Phase 4 — Safety & ops
16. **Nightly reconcile:** per store, pull current Shopify stock, re-baseline `last_synced_qty`, flag drift between Grape's expectation and Shopify's actual.
17. **Oversell buffer:** configurable per-variant hold (default 1–2 units); don't sell Shopify's last unit.
18. **Uninstall handling:** on `app/uninstalled`, mark merchant `inactive` and hide their catalogue so we never sell stock we can no longer deduct.

---

## 7. Order Lifecycle (end to end)

1. Customer places order on Grape (prepaid → Grape collected payment; or COD → merchant collects on delivery).
2. Order is written to Grape's DB. Grape decrements local sellable qty.
3. Grape calls `inventoryAdjustQuantities` (−1 delta) on the merchant's Shopify store → their storefront stays truthful.
4. Merchant opens the **Grape Merchant portal**, sees the new order (prepaid/COD flagged, COD shows collect-amount).
5. Merchant marks it **processed → shipped**. Status writes back to Grape and surfaces to the customer.
6. If the order RTOs/returns, the merchant **manually adds the unit back in Shopify**. Nightly reconcile picks up the corrected Shopify number.

---

## 8. Known Risks & Mitigations

| Risk | Mitigation |
|---|---|
| **Oversell window** — unit bought on Grape and merchant's storefront near-simultaneously | Can't fully eliminate (Shopify won't cede source of truth). Mitigate with: oversell buffer + webhooks (shrink window) + nightly reconcile (catch drift). Accept residual risk for launch. |
| Merchant forgets to restore RTO unit | Shopify under-counts → Grape stops selling that variant. **Safe direction** (under-sell, not oversell). |
| `set` instead of `adjust` overwrites a storefront sale | Always use relative **adjust**, never absolute set. |
| Multi-location merchant | Store `location_id` per merchant; never hard-code. Start assuming one location but don't bake that assumption in. |
| SKU-based mapping breaks on edit | Key mapping off numeric `shopify_variant_id`. |
| API rate limits across many stores | Per-store throttled job queue from the start; use GraphQL to cut call count. |
| Missed webhooks | Nightly reconcile is the backstop. |
| App uninstalled but we keep selling | `app/uninstalled` → mark inactive + hide catalogue immediately. |

---

## 9. Open Items to Confirm Before/During Build

- [ ] Confirm Grape's auto-tagging/styling pipeline can run **unattended** on ingest (Phase 1, step 7).
- [ ] Confirm default **oversell buffer** value (suggested: 1–2 units).
- [ ] Confirm nightly reconcile time window and alerting destination for flagged drift.
- [ ] Confirm merchant portal auth method (email/password, magic link, etc.).

---

## 10. Definition of Done

- A merchant installs via link; their catalogue appears on Grape within one sync cycle, correctly tagged and auto-published.
- Editing a product/price/stock on Shopify reflects on Grape (webhook or next poll).
- A Grape sale decrements the correct variant at the correct location in Shopify via relative adjust.
- The merchant sees that order in the Grape portal, with prepaid/COD and COD collect-amount correct, and can mark it processed/shipped with status flowing back to the customer.
- Draft/archived/deleted/out-of-stock Shopify products are never buyable on Grape.
- Uninstalling the app stops sync and hides the catalogue.
- Nightly reconcile runs and flags drift.
