/**
 * Shopify-state → Grape-visibility rules (spec §5.3).
 *
 * Strict and fully automated: "no human catches errors". Pure function, unit
 * tested. Decides whether a mapped variant is buyable on Grape.
 *
 * | Shopify state          | Grape behaviour            |
 * |------------------------|----------------------------|
 * | Active + stock > buffer| Buyable                    |
 * | Draft                  | Hidden / not buyable       |
 * | Archived               | Hidden / not buyable       |
 * | Deleted                | Hidden / not buyable       |
 * | Stock ≤ buffer         | Not buyable (shown sold out)|
 */

import type { ShopifyStatus } from '../types/index.js';

/** Shopify state for the visibility decision, including deletion (§4.5 products/delete). */
export type VisibilityStatus = ShopifyStatus | 'deleted';

/**
 * Grape's resulting treatment of a variant:
 * - `buyable`   — listed and purchasable
 * - `sold_out`  — listed but shown sold out (active product, no sellable stock)
 * - `hidden`    — not listed at all (draft / archived / deleted)
 */
export type Visibility = 'buyable' | 'sold_out' | 'hidden';

/**
 * Resolve visibility from Shopify state and the already-computed sellable
 * quantity (see {@link computeSellableQty} — that value already nets out the
 * oversell buffer, so "sellableQty ≤ 0" is the precise generalization of the
 * spec's "stock ≤ buffer", and stays safe when writebacks are in flight).
 *
 * Non-active states hide the product outright, regardless of stock.
 */
export function resolveVisibility(status: VisibilityStatus, sellableQty: number): Visibility {
  if (status !== 'active') {
    return 'hidden';
  }
  return sellableQty > 0 ? 'buyable' : 'sold_out';
}
