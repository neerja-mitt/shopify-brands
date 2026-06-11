/**
 * Persistence ports (spec §5).
 *
 * Interfaces only — the rest of the app depends on these, not on a concrete
 * database. Two adapters implement them: an in-memory one (`memory.ts`, used by
 * tests and the scaffold runtime) and a Postgres one (`postgres.ts`, prod).
 *
 * Token handling rule (spec §4.3): the `Store` crossing these interfaces always
 * carries the token in PLAINTEXT (decrypted on read, encrypted on write). The
 * encrypted-at-rest blob never leaves the adapter.
 */

import type { MerchantProductMap, Store, StoreStatus } from '../types/index.js';

export interface StoreRepository {
  /** Insert or update a store. Adapter encrypts the access token at rest. */
  upsert(store: Store): Promise<void>;

  /** Fetch a store by domain, token decrypted. Null if not installed. */
  get(shopDomain: string): Promise<Store | null>;

  /** Flip status — e.g. `inactive` on app/uninstalled (spec §6 step 18). */
  setStatus(shopDomain: string, status: StoreStatus): Promise<void>;

  /** All active stores — used by the nightly reconcile sweep (spec §6 step 16). */
  listActive(): Promise<Store[]>;
}

export interface ProductMapRepository {
  /** Upsert a variant mapping, keyed on (shop_domain, shopify_variant_id). */
  upsert(row: MerchantProductMap): Promise<void>;

  /** Primary-key lookup. Used when reconciling a known Shopify variant. */
  getByShopVariant(
    shopDomain: string,
    shopifyVariantId: string,
  ): Promise<MerchantProductMap | null>;

  /**
   * Resolve a Grape variant back to its Shopify mapping — the inventory
   * writeback path (spec §6 Phase 2). Effectively 1:1.
   */
  getByGrapeVariant(grapeVariantId: string): Promise<MerchantProductMap | null>;

  /**
   * Look up by inventory_item_id within a store — the `inventory_levels/update`
   * webhook arrives keyed this way (spec §4.5).
   */
  getByInventoryItem(
    shopDomain: string,
    shopifyInventoryItemId: string,
  ): Promise<MerchantProductMap | null>;

  /** All mappings for a store — used by nightly reconcile and uninstall-hide. */
  listByShop(shopDomain: string): Promise<MerchantProductMap[]>;
}
