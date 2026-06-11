/**
 * Catalogue sync — PULL (spec §6 Phase 1).
 *
 * Initial import: paginate products + variants + inventory + price via the
 * GraphQL Admin API (one query per page covers all four) and upsert into
 * `merchant_product_map`, keyed off the stable `shopify_variant_id` (§5.1, §6
 * step 6). Inventory is read at the store's primary location.
 *
 * This populates the Shopify side of the mapping. The Grape side (auto-tag →
 * create listing → fill grape IDs, §6 step 7) is Phase 1.3 and is blocked on
 * confirming the Grape pipeline can run unattended (open item §9).
 */

import type { ProductMapRepository } from '../db/repositories.js';
import type { ShopifyGraphQLClient } from '../shopify/client.js';
import type { MerchantProductMap, ShopifyStatus, Store } from '../types/index.js';

const PRODUCTS_PER_PAGE = 50;
const VARIANTS_PER_PRODUCT = 100; // Shopify's max variants per product

/** One GraphQL page: products + their variants + inventory + price. */
const PRODUCTS_QUERY = `
query ProductsPage($cursor: String, $locationId: ID!) {
  products(first: ${PRODUCTS_PER_PAGE}, after: $cursor) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id
      status
      variants(first: ${VARIANTS_PER_PRODUCT}) {
        nodes {
          id
          price
          inventoryItem {
            id
            inventoryLevel(locationId: $locationId) {
              quantities(names: ["available"]) { name quantity }
            }
          }
        }
      }
    }
  }
}`;

// ── Response shape ───────────────────────────────────────────────────────────
interface ProductsPageData {
  products: {
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
    nodes: ProductNode[];
  };
}
interface ProductNode {
  id: string;
  status: string; // ACTIVE | DRAFT | ARCHIVED
  variants: { nodes: VariantNode[] };
}
interface VariantNode {
  id: string;
  price: string;
  inventoryItem: {
    id: string;
    inventoryLevel: { quantities: Array<{ name: string; quantity: number }> } | null;
  } | null;
}

export interface ImportResult {
  products: number;
  variants: number;
}

/** Map Shopify's product status to our visibility status (§5.3).
 * Case-insensitive: GraphQL returns `ACTIVE`, webhook payloads return `active`. */
export function toShopifyStatus(status: string): ShopifyStatus {
  switch (status.toUpperCase()) {
    case 'ACTIVE':
      return 'active';
    case 'ARCHIVED':
      return 'archived';
    default:
      return 'draft'; // DRAFT and anything unexpected → hidden, the safe default
  }
}

/** Available quantity at the queried location, or 0 if untracked/absent. */
function availableQty(variant: VariantNode): number {
  const q = variant.inventoryItem?.inventoryLevel?.quantities.find((x) => x.name === 'available');
  return q?.quantity ?? 0;
}

export interface ImportDeps {
  graphql: ShopifyGraphQLClient;
  maps: ProductMapRepository;
}

/**
 * Full catalogue import for a store. Paginates until exhausted, upserting a
 * mapping row per variant. Grape IDs are left null (published later).
 */
export async function importCatalogue(store: Store, deps: ImportDeps): Promise<ImportResult> {
  let cursor: string | null = null;
  let products = 0;
  let variants = 0;

  do {
    const data: ProductsPageData = await deps.graphql.query<ProductsPageData>(
      store,
      PRODUCTS_QUERY,
      { cursor, locationId: store.primaryLocationId },
    );

    for (const product of data.products.nodes) {
      products += 1;
      const shopifyStatus = toShopifyStatus(product.status);

      for (const variant of product.variants.nodes) {
        const inventoryItemId = variant.inventoryItem?.id;
        if (!inventoryItemId) continue; // no inventory item → can't map/deduct; skip

        const row: MerchantProductMap = {
          grapeListingId: null,
          grapeVariantId: null,
          shopDomain: store.shopDomain,
          shopifyProductId: product.id,
          shopifyVariantId: variant.id,
          shopifyInventoryItemId: inventoryItemId,
          locationId: store.primaryLocationId,
          lastSyncedQty: availableQty(variant),
          lastSyncedPrice: variant.price === undefined ? null : Number(variant.price),
          shopifyStatus,
          updatedAt: new Date(),
        };
        await deps.maps.upsert(row);
        variants += 1;
      }
    }

    cursor = data.products.pageInfo.hasNextPage ? data.products.pageInfo.endCursor : null;
  } while (cursor !== null);

  return { products, variants };
}
