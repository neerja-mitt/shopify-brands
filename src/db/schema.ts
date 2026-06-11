/**
 * Database schema (spec §5.1) — the single source of truth for the DDL.
 *
 * Kept as a TypeScript constant (not a loose `.sql` file) so it bundles into the
 * build and `runMigrations` can apply it on boot. Postgres dialect.
 *
 * This is the foundation: §5.1 says the mapping table is proven FIRST —
 * everything downstream depends on it being correct.
 */

export const SCHEMA_SQL = /* sql */ `
-- Stores: one row per installed merchant (spec §4.3). The access token is stored
-- ENCRYPTED AT REST — never persist the plaintext token.
CREATE TABLE IF NOT EXISTS stores (
    shop_domain            TEXT        PRIMARY KEY,
    access_token_encrypted TEXT        NOT NULL,
    primary_location_id    TEXT        NOT NULL,
    status                 TEXT        NOT NULL DEFAULT 'active',
    installed_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- merchant_product_map: variant-level mapping (spec §5.1). KEY OFF the numeric
-- shopify_variant_id, NOT the SKU — merchants edit SKUs; numeric IDs are stable.
CREATE TABLE IF NOT EXISTS merchant_product_map (
    grape_listing_id          TEXT        NOT NULL,
    grape_variant_id          TEXT        NOT NULL,
    shop_domain               TEXT        NOT NULL REFERENCES stores(shop_domain) ON DELETE CASCADE,
    shopify_product_id        TEXT        NOT NULL,
    shopify_variant_id        TEXT        NOT NULL,
    shopify_inventory_item_id TEXT        NOT NULL,
    location_id               TEXT        NOT NULL,
    last_synced_qty           INTEGER     NOT NULL DEFAULT 0,
    last_synced_price         NUMERIC(12,2),
    shopify_status            TEXT        NOT NULL,
    updated_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (shop_domain, shopify_variant_id)
);

-- Reverse lookup: Grape variant -> Shopify mapping (writeback path, §6 Phase 2).
CREATE INDEX IF NOT EXISTS idx_mpm_grape_variant
    ON merchant_product_map (grape_variant_id);

-- inventory_levels/update arrives keyed by inventory_item_id (§4.5).
CREATE INDEX IF NOT EXISTS idx_mpm_inventory_item
    ON merchant_product_map (shopify_inventory_item_id);
`;
