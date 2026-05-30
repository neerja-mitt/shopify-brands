-- ─────────────────────────────────────────────────────────────────────────────
-- Grape × Shopify integration — database schema (SCAFFOLD / DDL stub)
--
-- This is the foundation: spec §5.1 says the mapping table is built & proven
-- FIRST — everything downstream depends on it being correct.
--
-- Postgres dialect. Not wired to migrations yet; this captures the intended
-- shape so the rest of the scaffold can type against it.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Stores ───────────────────────────────────────────────────────────────────
-- One row per installed merchant store (spec §4.3). The access token is stored
-- ENCRYPTED AT REST — never persist the plaintext token.
CREATE TABLE IF NOT EXISTS stores (
    shop_domain            TEXT        PRIMARY KEY,          -- e.g. merchant.myshopify.com
    access_token_encrypted BYTEA       NOT NULL,             -- encrypted; see TOKEN_ENCRYPTION_KEY
    primary_location_id    TEXT        NOT NULL,             -- fetched via read_locations at install; never hard-coded (§4.3, risk §8)
    status                 TEXT        NOT NULL DEFAULT 'active',  -- 'active' | 'inactive' (set on app/uninstalled, §6 step 18)
    installed_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── merchant_product_map ─────────────────────────────────────────────────────
-- Variant-level mapping between Grape listings and Shopify variants (spec §5.1).
-- KEY OFF the numeric shopify_variant_id, NOT the SKU string — merchants edit
-- SKUs; numeric IDs are stable (spec §5.1, risk §8).
CREATE TABLE IF NOT EXISTS merchant_product_map (
    grape_listing_id          TEXT        NOT NULL,          -- Grape's own listing/product ID
    grape_variant_id          TEXT        NOT NULL,          -- Grape's variant ID
    shop_domain               TEXT        NOT NULL REFERENCES stores(shop_domain) ON DELETE CASCADE,
    shopify_product_id        TEXT        NOT NULL,          -- parent product
    shopify_variant_id        TEXT        NOT NULL,          -- STABLE KEY for mapping
    shopify_inventory_item_id TEXT        NOT NULL,          -- needed for inventory adjust
    location_id               TEXT        NOT NULL,          -- which location stock is deducted from
    last_synced_qty           INTEGER     NOT NULL DEFAULT 0,-- last known Shopify quantity (baseline, §5.2)
    last_synced_price         NUMERIC(12,2),                 -- last known price
    shopify_status            TEXT        NOT NULL,          -- 'active' | 'draft' | 'archived' (drives visibility, §5.3)
    updated_at                TIMESTAMPTZ NOT NULL DEFAULT now(),  -- last sync time

    PRIMARY KEY (shop_domain, shopify_variant_id)
);

-- Reverse lookup: given a Grape variant, find its Shopify mapping (writeback path, §6 Phase 2).
CREATE INDEX IF NOT EXISTS idx_mpm_grape_variant
    ON merchant_product_map (grape_variant_id);

-- Inventory-webhook lookup: inventory_levels/update arrives keyed by inventory_item_id (§4.5).
CREATE INDEX IF NOT EXISTS idx_mpm_inventory_item
    ON merchant_product_map (shopify_inventory_item_id);
