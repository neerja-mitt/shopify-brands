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

/** A variant's current Shopify state (inventory-item, location, qty, price). */
export interface VariantSnapshot {
  shopifyVariantId: string;
  shopifyInventoryItemId: string;
  locationId: string;
  qty: number;
  price: number | null;
}

/** A product with its mappable variants (no-inventory variants dropped). */
export interface ProductSnapshot {
  shopifyProductId: string;
  shopifyStatus: ShopifyStatus;
  variants: VariantSnapshot[];
}

/**
 * Fetch one page of the catalogue, parsed into product/variant snapshots.
 * Shared by import and reconcile so the query + parsing live in one place.
 */
export async function fetchProductsPage(
  store: Store,
  graphql: ShopifyGraphQLClient,
  cursor: string | null,
): Promise<{ products: ProductSnapshot[]; nextCursor: string | null }> {
  const data = await graphql.query<ProductsPageData>(store, PRODUCTS_QUERY, {
    cursor,
    locationId: store.primaryLocationId,
  });

  const products: ProductSnapshot[] = data.products.nodes.map((product) => ({
    shopifyProductId: product.id,
    shopifyStatus: toShopifyStatus(product.status),
    variants: product.variants.nodes
      .filter((v): v is VariantNode & { inventoryItem: { id: string } } => !!v.inventoryItem?.id)
      .map((v) => ({
        shopifyVariantId: v.id,
        shopifyInventoryItemId: v.inventoryItem.id,
        locationId: store.primaryLocationId,
        qty: availableQty(v),
        price: v.price === undefined ? null : Number(v.price),
      })),
  }));

  const nextCursor = data.products.pageInfo.hasNextPage ? data.products.pageInfo.endCursor : null;
  return { products, nextCursor };
}

/**
 * Build a mapping row from a snapshot, preserving the Grape IDs of any existing
 * row (so re-import/reconcile never wipes a published link).
 */
export function toMappingRow(
  shopDomain: string,
  shopifyProductId: string,
  shopifyStatus: ShopifyStatus,
  v: VariantSnapshot,
  existing: MerchantProductMap | null,
): MerchantProductMap {
  return {
    grapeListingId: existing?.grapeListingId ?? null,
    grapeVariantId: existing?.grapeVariantId ?? null,
    shopDomain,
    shopifyProductId,
    shopifyVariantId: v.shopifyVariantId,
    shopifyInventoryItemId: v.shopifyInventoryItemId,
    locationId: v.locationId,
    lastSyncedQty: v.qty,
    lastSyncedPrice: v.price,
    shopifyStatus,
    updatedAt: new Date(),
  };
}

export interface ImportDeps {
  graphql: ShopifyGraphQLClient;
  maps: ProductMapRepository;
}

/**
 * Full catalogue import for a store. Paginates until exhausted, upserting a
 * mapping row per variant. Grape IDs of existing rows are preserved.
 */
export async function importCatalogue(store: Store, deps: ImportDeps): Promise<ImportResult> {
  let cursor: string | null = null;
  let products = 0;
  let variants = 0;

  do {
    const page = await fetchProductsPage(store, deps.graphql, cursor);
    for (const product of page.products) {
      products += 1;
      for (const v of product.variants) {
        const existing = await deps.maps.getByShopVariant(store.shopDomain, v.shopifyVariantId);
        await deps.maps.upsert(
          toMappingRow(store.shopDomain, product.shopifyProductId, product.shopifyStatus, v, existing),
        );
        variants += 1;
      }
    }
    cursor = page.nextCursor;
  } while (cursor !== null);

  return { products, variants };
}
