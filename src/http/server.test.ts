import assert from 'node:assert/strict';
import { createHmac, randomBytes } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { after, before, test } from 'node:test';

import { InMemoryStoreRepository } from '../db/memory.js';
import type { LocationFetcher, TokenExchanger } from '../shopify/oauth.js';
import { createServer } from './server.js';

const API_SECRET = 'test_app_secret';
const ENC_KEY = randomBytes(32).toString('hex');

const stores = new InMemoryStoreRepository(ENC_KEY);
const okExchanger: TokenExchanger = { async exchange() { return { accessToken: 'tok' }; } };
const okLocations: LocationFetcher = { async primaryLocationId() { return 'gid://shopify/Location/1'; } };

const server = createServer({
  config: {
    apiKey: 'key_abc',
    apiSecret: API_SECRET,
    scopes: ['read_products', 'read_inventory'],
    appUrl: 'https://grape.town',
  },
  stores,
  tokenExchanger: okExchanger,
  locationFetcher: okLocations,
});

let base = '';

before(async () => {
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const { port } = server.address() as AddressInfo;
  base = `http://localhost:${port}`;
});

after(() => {
  server.close();
});

test('GET /health returns ok', async () => {
  const res = await fetch(`${base}/health`);
  assert.equal(res.status, 200);
  assert.equal(await res.text(), 'ok');
});

test('GET /auth without a valid shop is rejected', async () => {
  const res = await fetch(`${base}/auth`);
  assert.equal(res.status, 400);
});

test('GET /auth with a valid shop redirects to Shopify consent and sets a state cookie', async () => {
  const res = await fetch(`${base}/auth?shop=merchant.myshopify.com`, { redirect: 'manual' });
  assert.equal(res.status, 302);
  const location = res.headers.get('location') ?? '';
  assert.ok(location.startsWith('https://merchant.myshopify.com/admin/oauth/authorize'));
  assert.match(res.headers.get('set-cookie') ?? '', /grape_oauth_state=/);
});

test('GET /auth/callback without the state cookie is rejected', async () => {
  const res = await fetch(`${base}/auth/callback?shop=merchant.myshopify.com&code=c`, {
    redirect: 'manual',
  });
  assert.equal(res.status, 400);
});

test('POST /webhooks/shopify rejects a bad HMAC', async () => {
  const res = await fetch(`${base}/webhooks/shopify`, {
    method: 'POST',
    headers: { 'X-Shopify-Hmac-Sha256': 'nope', 'X-Shopify-Topic': 'app/uninstalled' },
    body: '{}',
  });
  assert.equal(res.status, 401);
});

test('POST /webhooks/shopify with a valid HMAC marks an uninstalled store inactive', async () => {
  const shop = 'leaving.myshopify.com';
  await stores.upsert({
    shopDomain: shop,
    accessToken: 'tok',
    primaryLocationId: 'gid://shopify/Location/1',
    status: 'active',
    installedAt: new Date(),
    updatedAt: new Date(),
  });

  const body = JSON.stringify({ shop_domain: shop });
  const hmac = createHmac('sha256', API_SECRET).update(body).digest('base64');
  const res = await fetch(`${base}/webhooks/shopify`, {
    method: 'POST',
    headers: {
      'X-Shopify-Hmac-Sha256': hmac,
      'X-Shopify-Topic': 'app/uninstalled',
      'X-Shopify-Shop-Domain': shop,
    },
    body,
  });

  assert.equal(res.status, 200);
  assert.equal((await stores.get(shop))?.status, 'inactive');
});
