import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { test } from 'node:test';

import { newDb } from 'pg-mem';
import type { Pool } from 'pg';

import type { MerchantProductMap, Store } from '../types/index.js';
import { runMigrations } from './migrate.js';
import { PostgresProductMapRepository, PostgresStoreRepository } from './postgres.js';

const ENC_KEY = randomBytes(32).toString('hex');

/** Fresh in-memory Postgres with the schema applied, per test. */
async function freshPool(): Promise<Pool> {
  const db = newDb();
  const { Pool: MemPool } = db.adapters.createPg();
  const pool = new MemPool() as unknown as Pool;
  await runMigrations(pool);
  return pool;
}

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

// ── Stores ───────────────────────────────────────────────────────────────────

test('pg: store round-trips with the token encrypted at rest', async () => {
  const pool = await freshPool();
  const repo = new PostgresStoreRepository(pool, ENC_KEY);
  await repo.upsert(makeStore());

  // Decrypted on read.
  assert.equal((await repo.get('merchant.myshopify.com'))?.accessToken, 'plaintext-token-value');

  // The stored column is ciphertext, never the plaintext.
  const { rows } = await pool.query('SELECT access_token_encrypted FROM stores');
  assert.notEqual(rows[0].access_token_encrypted, 'plaintext-token-value');
});

test('pg: upsert overwrites; setStatus flips status', async () => {
  const pool = await freshPool();
  const repo = new PostgresStoreRepository(pool, ENC_KEY);
  await repo.upsert(makeStore());
  await repo.upsert(makeStore({ accessToken: 'rotated' }));
  assert.equal((await repo.get('merchant.myshopify.com'))?.accessToken, 'rotated');

  await repo.setStatus('merchant.myshopify.com', 'inactive');
  assert.equal((await repo.get('merchant.myshopify.com'))?.status, 'inactive');
});

test('pg: get returns null for an unknown store', async () => {
  const pool = await freshPool();
  const repo = new PostgresStoreRepository(pool, ENC_KEY);
  assert.equal(await repo.get('nope.myshopify.com'), null);
});

// ── Product map ──────────────────────────────────────────────────────────────

test('pg: mapping round-trips and is found by every lookup path', async () => {
  const pool = await freshPool();
  const stores = new PostgresStoreRepository(pool, ENC_KEY);
  const maps = new PostgresProductMapRepository(pool);
  await stores.upsert(makeStore()); // FK parent
  await maps.upsert(makeMapping());

  assert.equal(
    (await maps.getByShopVariant('merchant.myshopify.com', 'gid://shopify/ProductVariant/200'))
      ?.grapeVariantId,
    'grape-variant-1',
  );
  assert.equal(
    (await maps.getByGrapeVariant('grape-variant-1'))?.shopifyInventoryItemId,
    'gid://shopify/InventoryItem/300',
  );
  assert.equal(
    (await maps.getByInventoryItem('merchant.myshopify.com', 'gid://shopify/InventoryItem/300'))
      ?.shopifyVariantId,
    'gid://shopify/ProductVariant/200',
  );
  // NUMERIC price comes back as a real number.
  assert.equal(
    (await maps.getByShopVariant('merchant.myshopify.com', 'gid://shopify/ProductVariant/200'))
      ?.lastSyncedPrice,
    19.99,
  );
});

test('pg: upsert on the same PK updates rather than duplicating', async () => {
  const pool = await freshPool();
  const stores = new PostgresStoreRepository(pool, ENC_KEY);
  const maps = new PostgresProductMapRepository(pool);
  await stores.upsert(makeStore());
  await maps.upsert(makeMapping({ lastSyncedQty: 10 }));
  await maps.upsert(makeMapping({ lastSyncedQty: 4 }));

  const rows = await maps.listByShop('merchant.myshopify.com');
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.lastSyncedQty, 4);
});

test('pg: listByShop isolates stores', async () => {
  const pool = await freshPool();
  const stores = new PostgresStoreRepository(pool, ENC_KEY);
  const maps = new PostgresProductMapRepository(pool);
  await stores.upsert(makeStore());
  await stores.upsert(makeStore({ shopDomain: 'other.myshopify.com' }));
  await maps.upsert(makeMapping());
  await maps.upsert(
    makeMapping({
      shopDomain: 'other.myshopify.com',
      shopifyVariantId: 'gid://shopify/ProductVariant/999',
      grapeVariantId: 'grape-variant-2',
    }),
  );

  assert.equal((await maps.listByShop('merchant.myshopify.com')).length, 1);
  assert.equal((await maps.listByShop('other.myshopify.com')).length, 1);
});
