import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { test } from 'node:test';

import { InMemoryProductMapRepository, InMemoryStoreRepository } from '../db/memory.js';
import type { ShopifyGraphQLClient } from '../shopify/client.js';
import type { MerchantProductMap, Store } from '../types/index.js';
import { onGrapeOrderConfirmed } from './inventory.js';

const ENC_KEY = randomBytes(32).toString('hex');
const SHOP = 'merchant.myshopify.com';

function makeStore(overrides: Partial<Store> = {}): Store {
  return {
    shopDomain: SHOP,
    accessToken: 'tok',
    primaryLocationId: 'gid://shopify/Location/1',
    status: 'active',
    installedAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeMapping(overrides: Partial<MerchantProductMap> = {}): MerchantProductMap {
  return {
    grapeListingId: 'grape-listing-1',
    grapeVariantId: 'grape-variant-1',
    shopDomain: SHOP,
    shopifyProductId: 'gid://shopify/Product/100',
    shopifyVariantId: 'gid://shopify/ProductVariant/200',
    shopifyInventoryItemId: 'gid://shopify/InventoryItem/300',
    locationId: 'gid://shopify/Location/1',
    lastSyncedQty: 10,
    lastSyncedPrice: 19.99,
    shopifyStatus: 'active',
    updatedAt: new Date(),
    ...overrides,
  };
}

/** Records the variables passed to the adjust mutation; returns no userErrors. */
function recordingClient(): { client: ShopifyGraphQLClient; calls: unknown[] } {
  const calls: unknown[] = [];
  const client: ShopifyGraphQLClient = {
    async query<T>(_s: Store, _q: string, vars?: Record<string, unknown>): Promise<T> {
      calls.push(vars);
      return { inventoryAdjustQuantities: { userErrors: [] } } as T;
    },
  };
  return { client, calls };
}

async function seed() {
  const stores = new InMemoryStoreRepository(ENC_KEY);
  const productMap = new InMemoryProductMapRepository();
  await stores.upsert(makeStore());
  await productMap.upsert(makeMapping());
  return { stores, productMap };
}

test('decrements Shopify with a NEGATIVE relative delta (never set)', async () => {
  const { stores, productMap } = await seed();
  const { client, calls } = recordingClient();

  await onGrapeOrderConfirmed({ grapeVariantId: 'grape-variant-1' }, 2, {
    graphql: client,
    stores,
    productMap,
  });

  const input = (calls[0] as { input: { changes: Array<{ delta: number; inventoryItemId: string; locationId: string }>; name: string } }).input;
  assert.equal(input.name, 'available');
  assert.equal(input.changes[0]?.delta, -2);
  assert.equal(input.changes[0]?.inventoryItemId, 'gid://shopify/InventoryItem/300');
  assert.equal(input.changes[0]?.locationId, 'gid://shopify/Location/1');
});

test('refreshes the local baseline after a successful adjust', async () => {
  const { stores, productMap } = await seed();
  const { client } = recordingClient();

  await onGrapeOrderConfirmed({ grapeVariantId: 'grape-variant-1' }, 3, {
    graphql: client,
    stores,
    productMap,
  });

  const row = await productMap.getByGrapeVariant('grape-variant-1');
  assert.equal(row?.lastSyncedQty, 7); // 10 - 3
});

test('resolves the variant by shop + shopify variant id (pre-publish path)', async () => {
  const { stores, productMap } = await seed();
  const { client, calls } = recordingClient();

  await onGrapeOrderConfirmed(
    { shopDomain: SHOP, shopifyVariantId: 'gid://shopify/ProductVariant/200' },
    1,
    { graphql: client, stores, productMap },
  );
  assert.equal(calls.length, 1);
});

test('throws when no mapping is found', async () => {
  const { stores, productMap } = await seed();
  const { client } = recordingClient();
  await assert.rejects(
    onGrapeOrderConfirmed({ grapeVariantId: 'nope' }, 1, { graphql: client, stores, productMap }),
    /No mapping/,
  );
});

test('throws when the store is inactive (uninstalled)', async () => {
  const { stores, productMap } = await seed();
  await stores.setStatus(SHOP, 'inactive');
  const { client } = recordingClient();
  await assert.rejects(
    onGrapeOrderConfirmed({ grapeVariantId: 'grape-variant-1' }, 1, {
      graphql: client,
      stores,
      productMap,
    }),
    /not active/,
  );
});

test('surfaces Shopify userErrors as a failure', async () => {
  const { stores, productMap } = await seed();
  const client: ShopifyGraphQLClient = {
    async query<T>(): Promise<T> {
      return {
        inventoryAdjustQuantities: { userErrors: [{ field: null, message: 'Inventory item not stocked' }] },
      } as T;
    },
  };
  await assert.rejects(
    onGrapeOrderConfirmed({ grapeVariantId: 'grape-variant-1' }, 1, {
      graphql: client,
      stores,
      productMap,
    }),
    /inventoryAdjustQuantities failed/,
  );
});

test('rejects a non-positive quantity', async () => {
  const { stores, productMap } = await seed();
  const { client } = recordingClient();
  await assert.rejects(
    onGrapeOrderConfirmed({ grapeVariantId: 'grape-variant-1' }, 0, {
      graphql: client,
      stores,
      productMap,
    }),
    /must be positive/,
  );
});
