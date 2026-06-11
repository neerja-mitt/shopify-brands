/**
 * Grape sellable-quantity formula (spec §5.2).
 *
 * Pure function — no I/O. This is the single source of truth for "how many of
 * this variant may Grape sell right now", so it lives in one place and is
 * unit-tested directly.
 *
 *   grape_sellable_qty = last_synced_shopify_qty
 *                      − grape_orders_not_yet_reflected_in_shopify
 *                      − oversell_buffer
 *
 * - We trust Shopify's number as the baseline at each sync.
 * - We subtract Grape orders decremented locally whose writeback may be in flight.
 * - We subtract a small buffer so we never sell Shopify's last unit.
 */

import type { SellableQtyInputs } from '../types/index.js';

/**
 * Compute Grape's sellable quantity. Never returns a negative number — a
 * negative result means "nothing to sell", i.e. 0 (safe, under-sell direction).
 */
export function computeSellableQty(inputs: SellableQtyInputs): number {
  const { lastSyncedShopifyQty, grapeOrdersNotYetReflectedInShopify, oversellBuffer } = inputs;

  const raw =
    lastSyncedShopifyQty - grapeOrdersNotYetReflectedInShopify - oversellBuffer;

  return Math.max(0, raw);
}
