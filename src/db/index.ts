/**
 * Database access layer (SCAFFOLD — spec §5).
 *
 * Thin entry point for persistence. The schema lives in `schema.sql`; a real
 * client (pg / a query builder / an ORM) gets wired here once Phase 1 starts.
 * Kept dependency-free at scaffold stage so the skeleton type-checks.
 */

import type { MerchantProductMap, Store } from '../types/index.js';

/** Look up a store by domain (token returned decrypted, in-memory only). */
export async function getStore(_shopDomain: string): Promise<Store | null> {
  throw new Error('Not implemented (Phase 0): getStore');
}

/** Upsert a variant mapping row, keyed on (shop_domain, shopify_variant_id). */
export async function upsertMapping(_row: MerchantProductMap): Promise<void> {
  throw new Error('Not implemented (Phase 1): upsertMapping');
}

/** Resolve a Grape variant back to its Shopify mapping (writeback path). */
export async function getMappingByGrapeVariant(
  _grapeVariantId: string,
): Promise<MerchantProductMap | null> {
  throw new Error('Not implemented (Phase 2): getMappingByGrapeVariant');
}
