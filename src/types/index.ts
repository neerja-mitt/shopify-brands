/**
 * Shared domain types (SCAFFOLD).
 *
 * Mirrors the data model in `src/db/schema.ts` (spec §5). These are the
 * contracts the sync/writeback/portal layers type against. No logic here.
 */

/** Lifecycle status of an installed store (spec §4.3, §6 step 18). */
export type StoreStatus = 'active' | 'inactive';

/** Shopify product/variant state, drives Grape visibility (spec §5.3). */
export type ShopifyStatus = 'active' | 'draft' | 'archived';

/**
 * An installed merchant store. The access token is held encrypted at rest;
 * it is decrypted only in-memory when making Shopify API calls (spec §4.3).
 */
export interface Store {
  shopDomain: string; // e.g. merchant.myshopify.com
  /** Decrypted only at call time — never logged, never persisted in plaintext. */
  accessToken: string;
  /** Fetched via read_locations at install; never hard-coded (spec §4.3). */
  primaryLocationId: string;
  status: StoreStatus;
  installedAt: Date;
  updatedAt: Date;
}

/**
 * Variant-level mapping row (spec §5.1).
 * Keyed off the stable numeric `shopifyVariantId`, not the editable SKU.
 */
export interface MerchantProductMap {
  grapeListingId: string;
  grapeVariantId: string;
  shopDomain: string;
  shopifyProductId: string;
  shopifyVariantId: string; // stable mapping key
  shopifyInventoryItemId: string; // required for inventory adjust
  locationId: string;
  lastSyncedQty: number; // Shopify baseline (spec §5.2)
  lastSyncedPrice: number | null;
  shopifyStatus: ShopifyStatus;
  updatedAt: Date;
}

/**
 * Grape's sellable quantity for a variant (spec §5.2):
 *
 *   grape_sellable_qty = last_synced_shopify_qty
 *                      − grape_orders_not_yet_reflected_in_shopify
 *                      − oversell_buffer
 *
 * Pure formula; lives here so callers share one definition. (No business
 * logic wired yet — this is the canonical computation reference.)
 */
export interface SellableQtyInputs {
  lastSyncedShopifyQty: number;
  grapeOrdersNotYetReflectedInShopify: number;
  oversellBuffer: number;
}
