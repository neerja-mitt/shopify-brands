/**
 * Nightly reconcile (spec §6 Phase 4, step 16).
 *
 * The backstop for missed webhooks and manual RTO add-backs. Per store: pull
 * current Shopify stock, re-baseline `last_synced_qty`, and flag any drift
 * between Grape's last-known expectation and Shopify's actual.
 */

import type { ProductMapRepository, StoreRepository } from '../db/repositories.js';
import type { ShopifyGraphQLClient } from '../shopify/client.js';
import { fetchProductsPage, toMappingRow } from '../sync/catalogue.js';
import type { Store } from '../types/index.js';

export interface DriftReport {
  shopDomain: string;
  shopifyVariantId: string;
  grapeExpectedQty: number;
  shopifyActualQty: number;
}

export interface ReconcileDeps {
  graphql: ShopifyGraphQLClient;
  maps: ProductMapRepository;
}

/**
 * Reconcile a single store: re-pull every product page, compare each variant's
 * current Shopify qty against our stored baseline, re-baseline to the actual,
 * and collect drift rows. Grape IDs are preserved.
 */
export async function reconcileStore(store: Store, deps: ReconcileDeps): Promise<DriftReport[]> {
  const drift: DriftReport[] = [];
  let cursor: string | null = null;

  do {
    const page = await fetchProductsPage(store, deps.graphql, cursor);
    for (const product of page.products) {
      for (const v of product.variants) {
        const existing = await deps.maps.getByShopVariant(store.shopDomain, v.shopifyVariantId);

        // Only an existing row can drift; a brand-new variant is just added.
        if (existing && existing.lastSyncedQty !== v.qty) {
          drift.push({
            shopDomain: store.shopDomain,
            shopifyVariantId: v.shopifyVariantId,
            grapeExpectedQty: existing.lastSyncedQty,
            shopifyActualQty: v.qty,
          });
        }

        await deps.maps.upsert(
          toMappingRow(store.shopDomain, product.shopifyProductId, product.shopifyStatus, v, existing),
        );
      }
    }
    cursor = page.nextCursor;
  } while (cursor !== null);

  return drift;
}

/**
 * Reconcile every active store. One store's failure doesn't stop the sweep —
 * it's logged and reconciliation continues. Returns drift per store.
 */
export async function reconcileAllStores(
  stores: StoreRepository,
  deps: ReconcileDeps,
): Promise<Map<string, DriftReport[]>> {
  const byStore = new Map<string, DriftReport[]>();
  for (const store of await stores.listActive()) {
    try {
      byStore.set(store.shopDomain, await reconcileStore(store, deps));
    } catch (err) {
      console.error(`[reconcile] ${store.shopDomain} failed:`, err);
    }
  }
  return byStore;
}

/**
 * Surface flagged drift to the configured alert destination (open item §9).
 * For now this logs a structured warning; a Slack/webhook sink can be wired in
 * later without changing callers.
 */
export function reportDrift(byStore: Map<string, DriftReport[]>, destination: string): void {
  const all = [...byStore.values()].flat();
  if (all.length === 0) {
    console.log('[reconcile] no drift detected');
    return;
  }
  console.warn(
    `[reconcile] ${all.length} drift rows across ${byStore.size} stores` +
      (destination ? ` (alert → ${destination})` : ''),
  );
  for (const d of all) {
    console.warn(
      `[reconcile] drift ${d.shopDomain} ${d.shopifyVariantId}: ` +
        `expected ${d.grapeExpectedQty}, actual ${d.shopifyActualQty}`,
    );
  }
}
