/**
 * Inventory writeback — PUSH (SCAFFOLD — spec §6 Phase 2).
 *
 * On a confirmed Grape sale, decrement the merchant's Shopify stock so their
 * own storefront stays truthful. CRITICAL RULE: relative ADJUST only, never an
 * absolute SET — a `set` would clobber a sale that happened on their storefront
 * between our read and write (spec §3, §6 step 11, risk §8).
 *
 * There is intentionally NO restore logic: RTO/return add-back is done manually
 * by the merchant in Shopify (spec §2, §6 step 12).
 */

import type { Store } from '../types/index.js';

/**
 * Apply a relative delta to a variant's inventory at a location via Shopify's
 * `inventoryAdjustQuantities` mutation. For a Grape sale, `delta` is negative
 * (e.g. -1). Never pass this an absolute target.
 */
export async function adjustInventory(
  _store: Store,
  _inventoryItemId: string,
  _locationId: string,
  _delta: number,
): Promise<void> {
  throw new Error('Not implemented (Phase 2): adjustInventory');
}

/**
 * Entry point for "Grape order confirmed" → decrement the mapped variant.
 * On rate-limit: retry respecting throttle. On hard failure: log + flag for
 * nightly reconcile. No compensating restore (spec §6 step 12).
 */
export async function onGrapeOrderConfirmed(_grapeVariantId: string, _qty: number): Promise<void> {
  throw new Error('Not implemented (Phase 2): onGrapeOrderConfirmed');
}
