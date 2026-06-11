/**
 * Postgres persistence adapters (spec §5) — PRODUCTION path.
 *
 * Implements the same ports as the in-memory adapter, against the schema in
 * `schema.sql`. NOT YET EXERCISED against a live database: the method bodies
 * are stubbed and the intended SQL is documented inline so the next session can
 * wire `pg` (or a query builder) with the queries already mapped out.
 *
 * When implementing: encrypt on write / decrypt on read at this boundary
 * (use `encryptToken`/`decryptToken`), exactly as the in-memory adapter does —
 * the `Store` returned upstream must carry the PLAINTEXT token (spec §4.3).
 */

import type { MerchantProductMap, Store, StoreStatus } from '../types/index.js';
import type { ProductMapRepository, StoreRepository } from './repositories.js';

export class PostgresStoreRepository implements StoreRepository {
  async upsert(_store: Store): Promise<void> {
    // INSERT INTO stores (shop_domain, access_token_encrypted, primary_location_id, status, ...)
    // VALUES ($1, $2, $3, $4, ...)
    // ON CONFLICT (shop_domain) DO UPDATE SET access_token_encrypted = EXCLUDED...., updated_at = now();
    throw new Error('Not implemented (Phase 0): PostgresStoreRepository.upsert');
  }

  async get(_shopDomain: string): Promise<Store | null> {
    // SELECT * FROM stores WHERE shop_domain = $1;  then decryptToken(...)
    throw new Error('Not implemented (Phase 0): PostgresStoreRepository.get');
  }

  async setStatus(_shopDomain: string, _status: StoreStatus): Promise<void> {
    // UPDATE stores SET status = $2, updated_at = now() WHERE shop_domain = $1;
    throw new Error('Not implemented (Phase 0): PostgresStoreRepository.setStatus');
  }
}

export class PostgresProductMapRepository implements ProductMapRepository {
  async upsert(_row: MerchantProductMap): Promise<void> {
    // INSERT INTO merchant_product_map (...) VALUES (...)
    // ON CONFLICT (shop_domain, shopify_variant_id) DO UPDATE SET ...;
    throw new Error('Not implemented (Phase 1): PostgresProductMapRepository.upsert');
  }

  async getByShopVariant(
    _shopDomain: string,
    _shopifyVariantId: string,
  ): Promise<MerchantProductMap | null> {
    // SELECT * FROM merchant_product_map WHERE shop_domain = $1 AND shopify_variant_id = $2;
    throw new Error('Not implemented (Phase 1): PostgresProductMapRepository.getByShopVariant');
  }

  async getByGrapeVariant(_grapeVariantId: string): Promise<MerchantProductMap | null> {
    // SELECT * FROM merchant_product_map WHERE grape_variant_id = $1;  (idx_mpm_grape_variant)
    throw new Error('Not implemented (Phase 2): PostgresProductMapRepository.getByGrapeVariant');
  }

  async getByInventoryItem(
    _shopDomain: string,
    _shopifyInventoryItemId: string,
  ): Promise<MerchantProductMap | null> {
    // SELECT * FROM merchant_product_map
    // WHERE shop_domain = $1 AND shopify_inventory_item_id = $2;  (idx_mpm_inventory_item)
    throw new Error('Not implemented (Phase 1): PostgresProductMapRepository.getByInventoryItem');
  }

  async listByShop(_shopDomain: string): Promise<MerchantProductMap[]> {
    // SELECT * FROM merchant_product_map WHERE shop_domain = $1;
    throw new Error('Not implemented (Phase 4): PostgresProductMapRepository.listByShop');
  }
}
