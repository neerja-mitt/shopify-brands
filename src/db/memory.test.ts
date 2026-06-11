import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { test } from 'node:test';

import type { MerchantProductMap, Store } from '../types/index.js';
import { InMemoryProductMapRepository, InMemoryStoreRepository } from './memory.js';

const KEY = randomBytes(32).toString('hex');

function makeStore(overrides: Partial<Store> = {}): Store {
  return {
    shopDomain: 'merchant.myshopify.com',
    accessToken: 'plaintext-token-value',
    primaryLocationId: 'gid://shopify/Location/1',
    status: 'active',
    installedAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

function makeMapping(overrides: Partial<MerchantProductMap> = {}): MerchantProductMap {
  return {
    grapeListingId: 'grape-listing-1',
    grapeVariantId: 'grape-variant-1',
    shopDomain: 'merchant.myshopify.com',
    shopifyProductId: 'gid://shopify/Product/100',
    shopifyVariantId: 'gid://shopify/ProductVariant/200',
    shopifyInventoryItemId: 'gid://shopify/InventoryItem/300',
    locationId: 'gid://shopify/Location/1',
    lastSyncedQty: 10,
    lastSyncedPrice: 19.99,
    shopifyStatus: 'active',
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

// ── Store repository ─────────────────────────────────────────────────────────

test('store round-trips with the plaintext token restored', async () => {
  const repo = new InMemoryStoreRepository(KEY);
  await repo.upsert(makeStore());
  const got = await repo.get('merchant.myshopify.com');
  assert.equal(got?.accessToken, 'plaintext-token-value');
  assert.equal(got?.primaryLocationId, 'gid://shopify/Location/1');
});

test('store get returns null for an unknown domain', async () => {
  const repo = new InMemoryStoreRepository(KEY);
  assert.equal(await repo.get('nope.myshopify.com'), null);
});

test('upsert overwrites an existing store', async () => {
  const repo = new InMemoryStoreRepository(KEY);
  await repo.upsert(makeStore());
  await repo.upsert(makeStore({ accessToken: 'rotated-token' }));
  const got = await repo.get('merchant.myshopify.com');
  assert.equal(got?.accessToken, 'rotated-token');
});

test('setStatus flips status (uninstall path) and is a no-op for unknown stores', async () => {
  const repo = new InMemoryStoreRepository(KEY);
  await repo.upsert(makeStore());
  await repo.setStatus('merchant.myshopify.com', 'inactive');
  assert.equal((await repo.get('merchant.myshopify.com'))?.status, 'inactive');
  await repo.setStatus('ghost.myshopify.com', 'inactive'); // must not throw
});

// ── Product-map repository ───────────────────────────────────────────────────

test('mapping is retrievable by its composite primary key', async () => {
  const repo = new InMemoryProductMapRepository();
  await repo.upsert(makeMapping());
  const got = await repo.getByShopVariant(
    'merchant.myshopify.com',
    'gid://shopify/ProductVariant/200',
  );
  assert.equal(got?.grapeVariantId, 'grape-variant-1');
});

test('mapping is retrievable by Grape variant (writeback path)', async () => {
  const repo = new InMemoryProductMapRepository();
  await repo.upsert(makeMapping());
  const got = await repo.getByGrapeVariant('grape-variant-1');
  assert.equal(got?.shopifyInventoryItemId, 'gid://shopify/InventoryItem/300');
});

test('mapping is retrievable by inventory item within a store (webhook path)', async () => {
  const repo = new InMemoryProductMapRepository();
  await repo.upsert(makeMapping());
  const got = await repo.getByInventoryItem(
    'merchant.myshopify.com',
    'gid://shopify/InventoryItem/300',
  );
  assert.equal(got?.shopifyVariantId, 'gid://shopify/ProductVariant/200');
});

test('upsert on the same PK updates rather than duplicating', async () => {
  const repo = new InMemoryProductMapRepository();
  await repo.upsert(makeMapping({ lastSyncedQty: 10 }));
  await repo.upsert(makeMapping({ lastSyncedQty: 4 }));
  const got = await repo.getByShopVariant(
    'merchant.myshopify.com',
    'gid://shopify/ProductVariant/200',
  );
  assert.equal(got?.lastSyncedQty, 4);
  assert.equal((await repo.listByShop('merchant.myshopify.com')).length, 1);
});

test('listByShop returns only that store’s rows', async () => {
  const repo = new InMemoryProductMapRepository();
  await repo.upsert(makeMapping());
  await repo.upsert(
    makeMapping({
      shopDomain: 'other.myshopify.com',
      shopifyVariantId: 'gid://shopify/ProductVariant/999',
      grapeVariantId: 'grape-variant-2',
    }),
  );
  const rows = await repo.listByShop('merchant.myshopify.com');
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.shopDomain, 'merchant.myshopify.com');
});

test('same variant id under different stores stays distinct', async () => {
  const repo = new InMemoryProductMapRepository();
  await repo.upsert(makeMapping({ grapeVariantId: 'a' }));
  await repo.upsert(
    makeMapping({ shopDomain: 'other.myshopify.com', grapeVariantId: 'b' }),
  );
  assert.equal(
    (await repo.getByShopVariant('merchant.myshopify.com', 'gid://shopify/ProductVariant/200'))
      ?.grapeVariantId,
    'a',
  );
  assert.equal(
    (await repo.getByShopVariant('other.myshopify.com', 'gid://shopify/ProductVariant/200'))
      ?.grapeVariantId,
    'b',
  );
});
