/**
 * Inventory writeback — PUSH (spec §6 Phase 2).
 *
 * On a confirmed Grape sale, decrement the merchant's Shopify stock so their own
 * storefront stays truthful. CRITICAL RULE: relative ADJUST only, never an
 * absolute SET — a `set` would clobber a sale that happened on their storefront
 * between our read and write (spec §3, §6 step 11, risk §8).
 *
 * There is intentionally NO restore logic: RTO/return add-back is done manually
 * by the merchant in Shopify (spec §2, §6 step 12).
 */

import type { ProductMapRepository, StoreRepository } from '../db/repositories.js';
import type { ShopifyGraphQLClient } from '../shopify/client.js';
import type { Store } from '../types/index.js';

/** Shopify reason for the adjustment (an external-channel sale). */
const ADJUST_REASON = 'correction';

const ADJUST_MUTATION = `
mutation AdjustInventory($input: InventoryAdjustQuantitiesInput!) {
  inventoryAdjustQuantities(input: $input) {
    userErrors { field message }
  }
}`;

interface AdjustResult {
  inventoryAdjustQuantities: {
    userErrors: Array<{ field: string[] | null; message: string }>;
  };
}

/**
 * Apply a relative delta to a variant's available quantity at a location via
 * `inventoryAdjustQuantities`. For a Grape sale, `delta` is negative (e.g. -1).
 * Never pass an absolute target. Throws on GraphQL user errors.
 */
export async function adjustInventory(
  store: Store,
  graphql: ShopifyGraphQLClient,
  inventoryItemId: string,
  locationId: string,
  delta: number,
): Promise<void> {
  const data = await graphql.query<AdjustResult>(store, ADJUST_MUTATION, {
    input: {
      reason: ADJUST_REASON,
      name: 'available',
      changes: [{ inventoryItemId, locationId, delta }],
    },
  });
  const errors = data.inventoryAdjustQuantities.userErrors;
  if (errors.length > 0) {
    throw new Error(`inventoryAdjustQuantities failed: ${JSON.stringify(errors)}`);
  }
}

/** How a confirmed Grape order references the sold variant. */
export interface OrderConfirmedRef {
  /** Preferred: Grape's variant id (once published). */
  grapeVariantId?: string;
  /** Fallback: the Shopify variant + its store (useful pre-publish / testing). */
  shopDomain?: string;
  shopifyVariantId?: string;
}

export interface WritebackDeps {
  graphql: ShopifyGraphQLClient;
  stores: StoreRepository;
  productMap: ProductMapRepository;
}

/**
 * Entry point for "Grape order confirmed" → decrement the mapped variant in
 * Shopify (spec §6 step 11). Resolves the mapping, adjusts by `-quantity`, and
 * refreshes the local baseline. Throws if the variant/store can't be resolved
 * or the adjust fails (caller logs + flags for nightly reconcile, §6 step 12).
 */
export async function onGrapeOrderConfirmed(
  ref: OrderConfirmedRef,
  quantity: number,
  deps: WritebackDeps,
): Promise<void> {
  if (quantity <= 0) {
    throw new Error('Quantity must be positive');
  }

  const mapping = ref.grapeVariantId
    ? await deps.productMap.getByGrapeVariant(ref.grapeVariantId)
    : ref.shopDomain && ref.shopifyVariantId
      ? await deps.productMap.getByShopVariant(ref.shopDomain, ref.shopifyVariantId)
      : null;

  if (!mapping) {
    throw new Error('No mapping found for the ordered variant');
  }

  const store = await deps.stores.get(mapping.shopDomain);
  if (!store || store.status !== 'active') {
    throw new Error(`Store ${mapping.shopDomain} is not active; cannot write back`);
  }

  await adjustInventory(
    store,
    deps.graphql,
    mapping.shopifyInventoryItemId,
    mapping.locationId,
    -quantity,
  );

  // Refresh the local baseline so sellable-qty math stays consistent (§5.2).
  // The inventory_levels/update webhook will also reflect this; both converge.
  mapping.lastSyncedQty = Math.max(0, mapping.lastSyncedQty - quantity);
  mapping.updatedAt = new Date();
  await deps.productMap.upsert(mapping);
}
