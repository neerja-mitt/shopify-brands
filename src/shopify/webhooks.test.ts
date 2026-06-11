import assert from 'node:assert/strict';
import { createHmac, randomBytes } from 'node:crypto';
import { test } from 'node:test';

import { InMemoryProductMapRepository, InMemoryStoreRepository } from '../db/memory.js';
import type { MerchantProductMap, Store } from '../types/index.js';
import type { ShopifyGraphQLClient } from './client.js';
import { dispatchWebhook, registerWebhooks, verifyHmac } from './webhooks.js';

const SECRET = 'test_app_secret';
const ENC_KEY = randomBytes(32).toString('hex');
const SHOP = 'merchant.myshopify.com';

function seededMap(overrides: Partial<MerchantProductMap> = {}): MerchantProductMap {
  return {
    grapeListingId: null,
    grapeVariantId: null,
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

function sign(body: Buffer, secret = SECRET): string {
  return createHmac('sha256', secret).update(body).digest('base64');
}

test('accepts a correctly signed payload', () => {
  const body = Buffer.from(JSON.stringify({ id: 123, topic: 'products/update' }));
  assert.equal(verifyHmac(body, sign(body), SECRET), true);
});

test('rejects a payload signed with the wrong secret', () => {
  const body = Buffer.from('{"id":1}');
  assert.equal(verifyHmac(body, sign(body, 'wrong_secret'), SECRET), false);
});

test('rejects a tampered body', () => {
  const body = Buffer.from('{"id":1}');
  const hmac = sign(body);
  const tampered = Buffer.from('{"id":2}');
  assert.equal(verifyHmac(tampered, hmac, SECRET), false);
});

test('rejects an empty / missing header', () => {
  const body = Buffer.from('{}');
  assert.equal(verifyHmac(body, '', SECRET), false);
});

test('rejects when no secret is configured', () => {
  const body = Buffer.from('{}');
  assert.equal(verifyHmac(body, sign(body), ''), false);
});

// ── dispatch handlers ────────────────────────────────────────────────────────

test('inventory_levels/update refreshes qty (numeric id → gid lookup)', async () => {
  const productMap = new InMemoryProductMapRepository();
  const stores = new InMemoryStoreRepository(ENC_KEY);
  await productMap.upsert(seededMap({ lastSyncedQty: 10 }));

  // Webhook payload carries the NUMERIC inventory_item_id (300), not the gid.
  await dispatchWebhook('inventory_levels/update', SHOP, { inventory_item_id: 300, available: 4 }, {
    stores,
    productMap,
  });

  const row = await productMap.getByShopVariant(SHOP, 'gid://shopify/ProductVariant/200');
  assert.equal(row?.lastSyncedQty, 4);
});

test('products/update refreshes status and price for known variants', async () => {
  const productMap = new InMemoryProductMapRepository();
  const stores = new InMemoryStoreRepository(ENC_KEY);
  await productMap.upsert(seededMap({ shopifyStatus: 'active', lastSyncedPrice: 19.99 }));

  await dispatchWebhook(
    'products/update',
    SHOP,
    { id: 100, status: 'draft', variants: [{ id: 200, price: '24.50' }] },
    { stores, productMap },
  );

  const row = await productMap.getByShopVariant(SHOP, 'gid://shopify/ProductVariant/200');
  assert.equal(row?.shopifyStatus, 'draft');
  assert.equal(row?.lastSyncedPrice, 24.5);
});

test('products/delete hides the product’s variants', async () => {
  const productMap = new InMemoryProductMapRepository();
  const stores = new InMemoryStoreRepository(ENC_KEY);
  await productMap.upsert(seededMap({ shopifyStatus: 'active' }));

  await dispatchWebhook('products/delete', SHOP, { id: 100 }, { stores, productMap });

  const row = await productMap.getByShopVariant(SHOP, 'gid://shopify/ProductVariant/200');
  assert.equal(row?.shopifyStatus, 'archived');
});

test('app/uninstalled marks the store inactive', async () => {
  const productMap = new InMemoryProductMapRepository();
  const stores = new InMemoryStoreRepository(ENC_KEY);
  await stores.upsert({
    shopDomain: SHOP,
    accessToken: 'tok',
    primaryLocationId: 'gid://shopify/Location/1',
    status: 'active',
    installedAt: new Date(),
    updatedAt: new Date(),
  } satisfies Store);

  await dispatchWebhook('app/uninstalled', SHOP, {}, { stores, productMap });
  assert.equal((await stores.get(SHOP))?.status, 'inactive');
});

// ── registration ─────────────────────────────────────────────────────────────

test('registerWebhooks subscribes every topic to the callback URL', async () => {
  const calls: Array<{ topic: unknown; url: unknown }> = [];
  const graphql: ShopifyGraphQLClient = {
    async query<T>(_store: Store, _q: string, vars?: Record<string, unknown>): Promise<T> {
      calls.push({ topic: vars?.topic, url: vars?.url });
      return { webhookSubscriptionCreate: { userErrors: [] } } as T;
    },
  };
  const store: Store = {
    shopDomain: SHOP,
    accessToken: 'tok',
    primaryLocationId: 'gid://shopify/Location/1',
    status: 'active',
    installedAt: new Date(),
    updatedAt: new Date(),
  };

  await registerWebhooks(store, { graphql, callbackUrl: 'https://app.example/webhooks/shopify' });

  const topics = calls.map((c) => c.topic);
  assert.deepEqual(topics, [
    'APP_UNINSTALLED',
    'PRODUCTS_UPDATE',
    'PRODUCTS_DELETE',
    'INVENTORY_LEVELS_UPDATE',
  ]);
  assert.ok(calls.every((c) => c.url === 'https://app.example/webhooks/shopify'));
});

test('registerWebhooks ignores "already exists" and never throws', async () => {
  const graphql: ShopifyGraphQLClient = {
    async query<T>(): Promise<T> {
      return {
        webhookSubscriptionCreate: {
          userErrors: [{ field: ['topic'], message: 'Address for this topic has already been taken' }],
        },
      } as T;
    },
  };
  const store: Store = {
    shopDomain: SHOP,
    accessToken: 'tok',
    primaryLocationId: 'gid://shopify/Location/1',
    status: 'active',
    installedAt: new Date(),
    updatedAt: new Date(),
  };
  // Should resolve without throwing.
  await registerWebhooks(store, { graphql, callbackUrl: 'https://app.example/webhooks/shopify' });
});
