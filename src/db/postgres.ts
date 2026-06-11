/**
 * Postgres persistence adapters (spec §5) — PRODUCTION path.
 *
 * Implements the repository ports against the schema in `schema.ts`. The `pg`
 * Pool is injected, so these are exercised in tests against an in-memory
 * Postgres (pg-mem) and in production against a real database — same SQL.
 *
 * Token handling (spec §4.3): encrypt on write / decrypt on read at this
 * boundary, so the plaintext token never touches the database and the `Store`
 * returned upstream always carries it decrypted (in-memory only).
 */

import type { Pool } from 'pg';

import { decryptToken, encryptToken } from '../crypto/tokens.js';
import type { MerchantProductMap, Store, StoreStatus } from '../types/index.js';
import type { ProductMapRepository, StoreRepository } from './repositories.js';

interface StoreRow {
  shop_domain: string;
  access_token_encrypted: string;
  primary_location_id: string;
  status: string;
  installed_at: Date;
  updated_at: Date;
}

interface MapRow {
  grape_listing_id: string;
  grape_variant_id: string;
  shop_domain: string;
  shopify_product_id: string;
  shopify_variant_id: string;
  shopify_inventory_item_id: string;
  location_id: string;
  last_synced_qty: number;
  last_synced_price: string | null; // NUMERIC comes back as string from pg
  shopify_status: string;
  updated_at: Date;
}

export class PostgresStoreRepository implements StoreRepository {
  private readonly pool: Pool;
  private readonly encryptionKey: string;

  constructor(pool: Pool, encryptionKey: string) {
    this.pool = pool;
    this.encryptionKey = encryptionKey;
  }

  async upsert(store: Store): Promise<void> {
    await this.pool.query(
      `INSERT INTO stores
         (shop_domain, access_token_encrypted, primary_location_id, status, installed_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (shop_domain) DO UPDATE SET
         access_token_encrypted = EXCLUDED.access_token_encrypted,
         primary_location_id    = EXCLUDED.primary_location_id,
         status                 = EXCLUDED.status,
         updated_at             = EXCLUDED.updated_at`,
      [
        store.shopDomain,
        encryptToken(store.accessToken, this.encryptionKey),
        store.primaryLocationId,
        store.status,
        store.installedAt,
        store.updatedAt,
      ],
    );
  }

  async get(shopDomain: string): Promise<Store | null> {
    const { rows } = await this.pool.query<StoreRow>(
      `SELECT * FROM stores WHERE shop_domain = $1`,
      [shopDomain],
    );
    const row = rows[0];
    if (!row) return null;
    return {
      shopDomain: row.shop_domain,
      accessToken: decryptToken(row.access_token_encrypted, this.encryptionKey),
      primaryLocationId: row.primary_location_id,
      status: row.status as StoreStatus,
      installedAt: row.installed_at,
      updatedAt: row.updated_at,
    };
  }

  async setStatus(shopDomain: string, status: StoreStatus): Promise<void> {
    await this.pool.query(
      `UPDATE stores SET status = $2, updated_at = now() WHERE shop_domain = $1`,
      [shopDomain, status],
    );
  }
}

export class PostgresProductMapRepository implements ProductMapRepository {
  private readonly pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  async upsert(row: MerchantProductMap): Promise<void> {
    await this.pool.query(
      `INSERT INTO merchant_product_map
         (grape_listing_id, grape_variant_id, shop_domain, shopify_product_id,
          shopify_variant_id, shopify_inventory_item_id, location_id,
          last_synced_qty, last_synced_price, shopify_status, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT (shop_domain, shopify_variant_id) DO UPDATE SET
         grape_listing_id          = EXCLUDED.grape_listing_id,
         grape_variant_id          = EXCLUDED.grape_variant_id,
         shopify_product_id        = EXCLUDED.shopify_product_id,
         shopify_inventory_item_id = EXCLUDED.shopify_inventory_item_id,
         location_id               = EXCLUDED.location_id,
         last_synced_qty           = EXCLUDED.last_synced_qty,
         last_synced_price         = EXCLUDED.last_synced_price,
         shopify_status            = EXCLUDED.shopify_status,
         updated_at                = EXCLUDED.updated_at`,
      [
        row.grapeListingId,
        row.grapeVariantId,
        row.shopDomain,
        row.shopifyProductId,
        row.shopifyVariantId,
        row.shopifyInventoryItemId,
        row.locationId,
        row.lastSyncedQty,
        row.lastSyncedPrice,
        row.shopifyStatus,
        row.updatedAt,
      ],
    );
  }

  async getByShopVariant(
    shopDomain: string,
    shopifyVariantId: string,
  ): Promise<MerchantProductMap | null> {
    const { rows } = await this.pool.query<MapRow>(
      `SELECT * FROM merchant_product_map WHERE shop_domain = $1 AND shopify_variant_id = $2`,
      [shopDomain, shopifyVariantId],
    );
    return rows[0] ? mapRowToDomain(rows[0]) : null;
  }

  async getByGrapeVariant(grapeVariantId: string): Promise<MerchantProductMap | null> {
    const { rows } = await this.pool.query<MapRow>(
      `SELECT * FROM merchant_product_map WHERE grape_variant_id = $1 LIMIT 1`,
      [grapeVariantId],
    );
    return rows[0] ? mapRowToDomain(rows[0]) : null;
  }

  async getByInventoryItem(
    shopDomain: string,
    shopifyInventoryItemId: string,
  ): Promise<MerchantProductMap | null> {
    const { rows } = await this.pool.query<MapRow>(
      `SELECT * FROM merchant_product_map
       WHERE shop_domain = $1 AND shopify_inventory_item_id = $2 LIMIT 1`,
      [shopDomain, shopifyInventoryItemId],
    );
    return rows[0] ? mapRowToDomain(rows[0]) : null;
  }

  async listByShop(shopDomain: string): Promise<MerchantProductMap[]> {
    const { rows } = await this.pool.query<MapRow>(
      `SELECT * FROM merchant_product_map WHERE shop_domain = $1`,
      [shopDomain],
    );
    return rows.map(mapRowToDomain);
  }
}

function mapRowToDomain(row: MapRow): MerchantProductMap {
  return {
    grapeListingId: row.grape_listing_id,
    grapeVariantId: row.grape_variant_id,
    shopDomain: row.shop_domain,
    shopifyProductId: row.shopify_product_id,
    shopifyVariantId: row.shopify_variant_id,
    shopifyInventoryItemId: row.shopify_inventory_item_id,
    locationId: row.location_id,
    lastSyncedQty: row.last_synced_qty,
    lastSyncedPrice: row.last_synced_price === null ? null : Number(row.last_synced_price),
    shopifyStatus: row.shopify_status as MerchantProductMap['shopifyStatus'],
    updatedAt: row.updated_at,
  };
}
