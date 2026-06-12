# What we need from the Grape team — product ingestion (Phase 1.3)

To make Shopify-sourced products **appear on Grape** and stay updated, our
integration needs a way to *send* products to Grape and get back Grape's IDs.
We do **not** mirror Grape's database — Grape owns its catalogue; we own the
Shopify↔Grape mapping. So we need an **interface**, not schema access.

This is the spec's open item §9 ("confirm the tagging pipeline can run unattended
on ingest"). Below is everything we need to know to build it.

---

## The shape of what we're after

```
Shopify product → our transform → [GRAPE INGESTION API] → Grape returns IDs
                                                            ↓
                            we store grape_listing_id / grape_variant_id
                            in merchant_product_map (columns already exist)
```

We already pull the full Shopify catalogue into `merchant_product_map`. The
missing link is the **call into Grape** and the IDs it returns.

---

## 1. The ingestion endpoint(s)

- **Is there an API to create a listing?** REST or GraphQL? Base URL(s) for
  staging + prod?
- **Auth:** how does our service authenticate to Grape — API key, service token,
  OAuth client-credentials? Where do we get it?
- **Does create return Grape's IDs synchronously** — a `listing_id` and a
  `variant_id` per variant? (We store these to link back. Without them, we can't
  map a Grape sale to the right Shopify variant for writeback.)
- **Create vs update vs upsert:** is it one idempotent upsert, or separate
  create/update? Is there an **idempotency key / external-id** so a retried
  create doesn't duplicate? (We can send `shop_domain` + `shopify_variant_id` as
  stable external ids if useful.)

## 2. The payload schema (what fields Grape expects)

We have all of this available from Shopify; we just need to know Grape's field
names, types, required-vs-optional, and validation:

- **Product level:** title, description, images (we have **URLs** — does Grape
  fetch them, or must we upload bytes?), product type/category, tags, brand.
- **Variant level:** options (e.g. size/colour), price + currency, SKU, weight.
- **Required vs optional fields**, and any validation rules (length, enums).
- **Category/taxonomy:** does Grape need a category id from its own taxonomy? If
  so, how do we map Shopify product type → Grape category (or does the tagging
  pipeline do that)?

## 3. The auto-tag / styling pipeline (§9)

- **Is it triggered automatically by the ingestion call, or a separate step?**
- **Can it run fully unattended** (no human curation gate)? The spec assumes
  auto-publish.
- **Sync or async?** If async, how do we learn a listing is live — a **callback/
  webhook** to us, a status field we poll, or fire-and-forget?
- Rough **latency** (seconds? minutes?) so we set expectations.

## 4. Keeping a listing updated (ongoing sync)

After publish, we continuously push changes (from Shopify webhooks + nightly
reconcile). We need to know how Grape wants each of these:

- **Availability / stock:** does Grape store a **quantity number**, or just a
  **buyable / sold-out** state? We compute a sellable qty
  (`shopify_qty − in-flight Grape orders − oversell buffer`) and a visibility
  (`buyable / sold_out / hidden`). Which does Grape want, and via which endpoint?
  (This is **high-frequency** — ideally a lightweight availability endpoint, not
  a full listing re-POST.)
- **Price change:** how to update a variant's price.
- **Status change:** Shopify draft/archived/deleted → Grape **hidden**; back to
  active → visible. How do we set/unset visibility?
- **Unpublish / delete:** how to take a listing down (for archived/deleted
  products, out-of-stock, and on **app uninstall** — we must hide the whole
  store's catalogue immediately, spec §6 step 18).

## 5. Merchant identity (important)

- A Grape listing belongs to a **merchant/seller**. How is that represented in
  Grape, and **how do we map a Shopify store (`shop_domain`) → a Grape merchant
  id?**
- Is the Grape merchant created during onboarding (and we're handed its id), or
  do we create/look it up via API? We'd store `grape_merchant_id` per store.

## 6. Operational

- **Error format** and which errors are retryable.
- **Rate limits** on Grape's API (we already pace Shopify; we'll pace Grape too).
- Staging environment we can test against.

---

## Minimum viable answer (if they're time-poor)

To unblock a first version of publishing, we minimally need:

1. **Create-listing endpoint** + auth, that **returns Grape listing + variant ids**.
2. The **required payload fields** (title, images, price, options).
3. **How to update availability** (qty or buyable state) and **how to hide** a
   listing.
4. **How a Shopify store maps to a Grape merchant id.**

Everything else (taxonomy nuance, async callbacks, full update semantics) can
follow once the basic publish loop works.

---

## Adjacent — not ingestion, but they'll ask: orders (Phase 2 trigger + Phase 3 portal)

Two more things from Grape, needed later for the order side (noting here so it's
one conversation):

- **Order-confirmed trigger:** Grape's order flow should call our
  `POST /orders/confirmed` (`{ grapeVariantId, quantity }`, Bearer token) when a
  unit sells, so we decrement Shopify. *(Already built and waiting.)*
- **Orders feed for the merchant portal:** how the portal reads a merchant's
  Grape orders (API/DB?) and writes back processed/shipped status — needed for
  Phase 3.

---

# ✅ Answers received from Grape — and what they change

### 1. Grape has **no variants** — each Shopify variant = one independent Grape product (SKU)
- Mapping is **Shopify variant → one Grape product** (1:1). The parent Shopify
  product is not represented on Grape.
- `merchant_product_map` already keys at the variant level. When we build
  publishing we'll **collapse the two Grape-id columns into a single
  `grape_product_id`** per variant (`grape_listing_id` + `grape_variant_id` are
  both currently unused/null — safe to change then).
- **Publish transform:** each variant becomes a Grape product whose title
  combines product title + variant options (e.g. "Button Tank Dress — S"),
  carrying that variant's price, SKU, image, and the parent's description/images.
- We'll fetch product **content** (title, description, images, options, SKU) from
  Shopify **at publish time** (not stored in the mapping table) to keep it lean.

### 2. Sellers exist; no `seller_id` yet — match by seller **name** for now
- Store **`grape_seller_name`** per installed store (set at onboarding); add
  **`grape_seller_id`** later when Grape introduces it, and switch to it.
- ⚠️ Name-matching is fragile (typos/renames). Push Grape to introduce a stable
  seller id.

### 3. NEW: fulfillment + fee attributes Grape needs — **not in Shopify**
These must be collected from the **merchant** (onboarding / portal), since
Shopify doesn't hold them:
- **Per SKU:** processing time (default **immediate**, else 24/48/72h), delivery
  timeline, returns accepted (Y/N), exchange accepted (Y/N).
- **Per merchant:** shipping fee, return fee, free-shipping-over ₹X.
- Implication: we need a **merchant settings** record + per-SKU fulfillment
  fields, captured via the portal (Phase 3) with sensible defaults, and included
  in the Grape publish payload.
- **Follow-up for Grape:** exact field names/format, and whether they live on the
  SKU payload, the merchant record, or both.

### 4. India-only → currency is always ₹ (INR)
- No multi-currency/conversion — simplifies pricing.
- ⚠️ **Guard:** the merchant's Shopify store must be in INR (our dev store is
  USD). We'll capture the store's `currencyCode` at install and flag/refuse if
  it isn't INR, so we never publish a non-INR price.
- Portal COD amounts + fees are all ₹.

## Sharpened data-model target (build alongside publishing + portal)
- `stores`: + `grape_seller_name`, `grape_seller_id` (nullable), `currency_code`,
  and merchant settings (shipping fee, return fee, free-shipping threshold) — or
  a separate `merchant_settings` table.
- `merchant_product_map`: `grape_listing_id` + `grape_variant_id` → single
  `grape_product_id`; + per-SKU fulfillment (processing time, delivery timeline,
  returns accepted, exchange accepted).

## Still needed from Grape (shorter list now)
- The **create-product endpoint** + auth, and the **exact payload fields**
  (incl. how images are passed + the #3 fulfillment/fee fields).
- Whether create **returns the Grape product id** synchronously.
- How to **update availability / price / visibility** and **unpublish**.
- Confirm onboarded merchants will run **INR** Shopify stores.

