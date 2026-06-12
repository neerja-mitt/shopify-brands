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
