import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { test } from 'node:test';

import { InMemoryProductMapRepository, InMemoryStoreRepository } from '../db/memory.js';
import type { ShopifyGraphQLClient } from '../shopify/client.js';
import type { MerchantProductMap, Store } from '../types/index.js';
import { reconcileAllStores, reconcileStore } from './reconcile.js';

const ENC_KEY = randomBytes(32).toString('hex');
const SHOP = 'merchant.myshopify.com';

const store: Store = {
  shopDomain: SHOP,
  accessToken: 'tok',
  primaryLocationId: 'gid://shopify/Location/1',
  status: 'active',
  installedAt: new Date(),
  updatedAt: new Date(),
};

function makeMapping(overrides: Partial<MerchantProductMap> = {}): MerchantProductMap {
  return {
    grapeListingId: 'gl-1',
    grapeVariantId: 'gv-1',
    shopDomain: SHOP,
    shopifyProductId: 'gid://shopify/Product/1',
    shopifyVariantId: 'gid://shopify/ProductVariant/2',
    shopifyInventoryItemId: 'gid://shopify/InventoryItem/3',
    locationId: 'gid://shopify/Location/1',
    lastSyncedQty: 10,
    lastSyncedPrice: 9.99,
    shopifyStatus: 'active',
    updatedAt: new Date(),
    ...overrides,
  };
}

/** One-page catalogue response with the given variant qty. */
function clientWithQty(qty: number): ShopifyGraphQLClient {
  return {
    async query<T>(): Promise<T> {
      return {
        products: {
          pageInfo: { hasNextPage: false, endCursor: null },
          nodes: [
            {
              id: 'gid://shopify/Product/1',
              status: 'ACTIVE',
              variants: {
                nodes: [
                  {
                    id: 'gid://shopify/ProductVariant/2',
                    price: '9.99',
                    inventoryItem: {
                      id: 'gid://shopify/InventoryItem/3',
                      inventoryLevel: { quantities: [{ name: 'available', quantity: qty }] },
                    },
                  },
                ],
              },
            },
          ],
        },
      } as T;
    },
  };
}

test('flags drift and re-baselines to the Shopify actual', async () => {
  const maps = new InMemoryProductMapRepository();
  await maps.upsert(makeMapping({ lastSyncedQty: 10 })); // we think 10
  const graphql = clientWithQty(6); // Shopify says 6

  const drift = await reconcileStore(store, { graphql, maps });

  assert.equal(drift.length, 1);
  assert.deepEqual(drift[0], {
    shopDomain: SHOP,
    shopifyVariantId: 'gid://shopify/ProductVariant/2',
    grapeExpectedQty: 10,
    shopifyActualQty: 6,
  });
  // Re-baselined to the actual, Grape link preserved.
  const row = await maps.getByShopVariant(SHOP, 'gid://shopify/ProductVariant/2');
  assert.equal(row?.lastSyncedQty, 6);
  assert.equal(row?.grapeVariantId, 'gv-1');
});

test('no drift when stored qty matches Shopify', async () => {
  const maps = new InMemoryProductMapRepository();
  await maps.upsert(makeMapping({ lastSyncedQty: 6 }));
  const drift = await reconcileStore(store, { graphql: clientWithQty(6), maps });
  assert.equal(drift.length, 0);
});

test('a brand-new variant is added without being flagged as drift', async () => {
  const maps = new InMemoryProductMapRepository(); // empty
  const drift = await reconcileStore(store, { graphql: clientWithQty(4), maps });
  assert.equal(drift.length, 0);
  assert.equal(
    (await maps.getByShopVariant(SHOP, 'gid://shopify/ProductVariant/2'))?.lastSyncedQty,
    4,
  );
});

test('reconcileAllStores sweeps every active store', async () => {
  const stores = new InMemoryStoreRepository(ENC_KEY);
  await stores.upsert(store);
  await stores.upsert({ ...store, shopDomain: 'inactive.myshopify.com', status: 'inactive' });
  const maps = new InMemoryProductMapRepository();
  await maps.upsert(makeMapping({ lastSyncedQty: 10 }));

  const byStore = await reconcileAllStores(stores, { graphql: clientWithQty(3), maps });

  assert.equal(byStore.size, 1); // only the active store
  assert.equal(byStore.get(SHOP)?.length, 1); // drift 10 → 3
});
