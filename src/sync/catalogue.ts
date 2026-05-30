/**
 * Catalogue sync — PULL (SCAFFOLD — spec §6 Phase 1).
 *
 * Phase 1 is the foundation and must be proven first: import products +
 * variants + inventory + price via the GraphQL Admin API, run them through
 * Grape's auto-tagging/styling pipeline, then AUTO-PUBLISH (no curation gate,
 * §2 / §5). Visibility follows the Shopify-state rules in §5.3.
 */

import type { Store } from '../types/index.js';

/**
 * Initial full import for a store: paginate products + variants + inventory +
 * price in batched GraphQL queries and upsert into `merchant_product_map`
 * (spec §6 step 6). Keyed off the stable shopify_variant_id.
 */
export async function importCatalogue(_store: Store): Promise<void> {
  throw new Error('Not implemented (Phase 1): importCatalogue');
}

/**
 * Push imported/updated variants through Grape's auto-tagging + styling
 * pipeline and auto-publish (spec §6 step 7).
 * NOTE (open item §9): confirm the tagging pipeline can run UNATTENDED on ingest.
 */
export async function autoTagAndPublish(_mappingKeys: string[]): Promise<void> {
  throw new Error('Not implemented (Phase 1): autoTagAndPublish');
}

/**
 * Apply Shopify-state → Grape-visibility rules (spec §5.3):
 *   active & stock>buffer → buyable; draft/archived/deleted → hidden;
 *   stock≤buffer → sold out. Strict: no human catches errors.
 */
export function applyVisibilityRules(_mapping: unknown): void {
  throw new Error('Not implemented (Phase 1): applyVisibilityRules');
}
