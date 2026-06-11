import assert from 'node:assert/strict';
import { test } from 'node:test';

import { InMemoryProductMapRepository } from '../db/memory.js';
import type { ShopifyGraphQLClient } from '../shopify/client.js';
import type { Store } from '../types/index.js';
import { importCatalogue } from './catalogue.js';

const store: Store = {
  shopDomain: 'merchant.myshopify.com',
  accessToken: 'tok',
  primaryLocationId: 'gid://shopify/Location/1',
  status: 'active',
  installedAt: new Date(),
  updatedAt: new Date(),
};

/** Build a products-page response with the given nodes + pagination. */
function page(nodes: unknown[], hasNextPage = false, endCursor: string | null = null) {
  return { products: { pageInfo: { hasNextPage, endCursor }, nodes } };
}

function variant(id: string, price: string, invItemId: string, qty: number | null) {
  return {
    id,
    price,
    inventoryItem: {
      id: invItemId,
      inventoryLevel:
        qty === null ? null : { quantities: [{ name: 'available', quantity: qty }] },
    },
  };
}

/** Mock client that returns queued pages in order (one per call). */
function mockClient(pages: unknown[]): ShopifyGraphQLClient {
  let i = 0;
  return {
    async query<T>(): Promise<T> {
      const p = pages[i++];
      return p as T;
    },
  };
}

test('imports variants with price, qty, status, and inventory item id', async () => {
  const maps = new InMemoryProductMapRepository();
  const graphql = mockClient([
    page([
      {
        id: 'gid://shopify/Product/1',
        status: 'ACTIVE',
        variants: {
          nodes: [
            variant('gid://shopify/ProductVariant/11', '19.99', 'gid://shopify/InventoryItem/111', 7),
          ],
        },
      },
    ]),
  ]);

  const result = await importCatalogue(store, { graphql, maps });

  assert.deepEqual(result, { products: 1, variants: 1 });
  const row = await maps.getByShopVariant('merchant.myshopify.com', 'gid://shopify/ProductVariant/11');
  assert.equal(row?.shopifyProductId, 'gid://shopify/Product/1');
  assert.equal(row?.shopifyInventoryItemId, 'gid://shopify/InventoryItem/111');
  assert.equal(row?.lastSyncedQty, 7);
  assert.equal(row?.lastSyncedPrice, 19.99);
  assert.equal(row?.shopifyStatus, 'active');
  assert.equal(row?.locationId, 'gid://shopify/Location/1');
  assert.equal(row?.grapeListingId, null); // not yet published
  assert.equal(row?.grapeVariantId, null);
});

test('paginates until hasNextPage is false', async () => {
  const maps = new InMemoryProductMapRepository();
  const graphql = mockClient([
    page(
      [
        {
          id: 'gid://shopify/Product/1',
          status: 'ACTIVE',
          variants: { nodes: [variant('v1', '10.00', 'i1', 1)] },
        },
      ],
      true,
      'CURSOR1',
    ),
    page([
      {
        id: 'gid://shopify/Product/2',
        status: 'DRAFT',
        variants: { nodes: [variant('v2', '20.00', 'i2', 2)] },
      },
    ]),
  ]);

  const result = await importCatalogue(store, { graphql, maps });
  assert.deepEqual(result, { products: 2, variants: 2 });
  assert.equal((await maps.listByShop('merchant.myshopify.com')).length, 2);
});

test('maps DRAFT and ARCHIVED to hidden statuses', async () => {
  const maps = new InMemoryProductMapRepository();
  const graphql = mockClient([
    page([
      { id: 'p-draft', status: 'DRAFT', variants: { nodes: [variant('vd', '1', 'id', 0)] } },
      { id: 'p-arch', status: 'ARCHIVED', variants: { nodes: [variant('va', '1', 'ia', 0)] } },
    ]),
  ]);

  await importCatalogue(store, { graphql, maps });
  assert.equal((await maps.getByShopVariant('merchant.myshopify.com', 'vd'))?.shopifyStatus, 'draft');
  assert.equal((await maps.getByShopVariant('merchant.myshopify.com', 'va'))?.shopifyStatus, 'archived');
});

test('treats missing inventory level as qty 0', async () => {
  const maps = new InMemoryProductMapRepository();
  const graphql = mockClient([
    page([
      { id: 'p', status: 'ACTIVE', variants: { nodes: [variant('v', '5.00', 'i', null)] } },
    ]),
  ]);
  await importCatalogue(store, { graphql, maps });
  assert.equal((await maps.getByShopVariant('merchant.myshopify.com', 'v'))?.lastSyncedQty, 0);
});

test('skips variants with no inventory item (can not be deducted)', async () => {
  const maps = new InMemoryProductMapRepository();
  const graphql = mockClient([
    page([
      {
        id: 'p',
        status: 'ACTIVE',
        variants: { nodes: [{ id: 'v', price: '5.00', inventoryItem: null }] },
      },
    ]),
  ]);
  const result = await importCatalogue(store, { graphql, maps });
  assert.deepEqual(result, { products: 1, variants: 0 });
  assert.equal((await maps.listByShop('merchant.myshopify.com')).length, 0);
});

test('re-import upserts rather than duplicating (qty refreshes)', async () => {
  const maps = new InMemoryProductMapRepository();
  const first = mockClient([
    page([{ id: 'p', status: 'ACTIVE', variants: { nodes: [variant('v', '5.00', 'i', 10)] } }]),
  ]);
  await importCatalogue(store, { graphql: first, maps });

  const second = mockClient([
    page([{ id: 'p', status: 'ACTIVE', variants: { nodes: [variant('v', '5.00', 'i', 3)] } }]),
  ]);
  await importCatalogue(store, { graphql: second, maps });

  const rows = await maps.listByShop('merchant.myshopify.com');
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.lastSyncedQty, 3);
});
