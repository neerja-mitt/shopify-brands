import assert from 'node:assert/strict';
import { createHmac, randomBytes } from 'node:crypto';
import { test } from 'node:test';

import { InMemoryStoreRepository } from '../db/memory.js';
import {
  buildAuthorizeUrl,
  completeInstall,
  generateState,
  isValidShopDomain,
  verifyOAuthHmac,
  type LocationFetcher,
  type TokenExchanger,
} from './oauth.js';

const SECRET = 'test_app_secret';
const ENC_KEY = randomBytes(32).toString('hex');

/** Sign a query map the way Shopify does for OAuth callbacks (hex, sorted). */
function signQuery(query: Record<string, string>, secret = SECRET): string {
  const message = Object.keys(query)
    .filter((k) => k !== 'hmac' && k !== 'signature')
    .sort()
    .map((k) => `${k}=${query[k]}`)
    .join('&');
  return createHmac('sha256', secret).update(message).digest('hex');
}

const okExchanger: TokenExchanger = {
  async exchange() {
    return { accessToken: 'shpat-fake-token' };
  },
};
const okLocations: LocationFetcher = {
  async primaryLocationId() {
    return 'gid://shopify/Location/42';
  },
};

// ── shop domain validation ───────────────────────────────────────────────────

test('accepts valid myshopify domains', () => {
  assert.equal(isValidShopDomain('merchant.myshopify.com'), true);
  assert.equal(isValidShopDomain('my-shop-123.myshopify.com'), true);
});

test('rejects SSRF / spoofed domains', () => {
  for (const bad of [
    'evil.com',
    'merchant.myshopify.com.evil.com',
    'merchant.myshopify.com/path',
    'merchant.myshopify.io',
    'MERCHANT.myshopify.com', // uppercase not allowed
    '.myshopify.com',
    '',
  ]) {
    assert.equal(isValidShopDomain(bad), false, `should reject ${bad}`);
  }
});

// ── authorize URL ────────────────────────────────────────────────────────────

test('builds an authorize URL with scopes, redirect, and state', () => {
  const url = new URL(
    buildAuthorizeUrl({
      shop: 'merchant.myshopify.com',
      state: 'nonce123',
      apiKey: 'key_abc',
      scopes: ['read_products', 'read_inventory'],
      redirectUri: 'https://grape.town/auth/callback',
    }),
  );
  assert.equal(url.origin + url.pathname, 'https://merchant.myshopify.com/admin/oauth/authorize');
  assert.equal(url.searchParams.get('client_id'), 'key_abc');
  assert.equal(url.searchParams.get('scope'), 'read_products,read_inventory');
  assert.equal(url.searchParams.get('redirect_uri'), 'https://grape.town/auth/callback');
  assert.equal(url.searchParams.get('state'), 'nonce123');
});

test('authorize URL rejects an invalid shop', () => {
  assert.throws(() =>
    buildAuthorizeUrl({
      shop: 'evil.com',
      state: 's',
      apiKey: 'k',
      scopes: [],
      redirectUri: 'https://grape.town/auth/callback',
    }),
  );
});

test('generateState produces distinct, non-empty nonces', () => {
  const a = generateState();
  const b = generateState();
  assert.notEqual(a, b);
  assert.ok(a.length >= 16);
});

// ── OAuth callback HMAC ──────────────────────────────────────────────────────

test('verifies a correctly signed callback', () => {
  const q: Record<string, string> = {
    shop: 'merchant.myshopify.com',
    code: 'auth_code',
    state: 'nonce123',
    timestamp: '1700000000',
  };
  q.hmac = signQuery(q);
  assert.equal(verifyOAuthHmac(q, SECRET), true);
});

test('rejects a tampered callback (param changed after signing)', () => {
  const q: Record<string, string> = { shop: 'merchant.myshopify.com', code: 'auth_code' };
  q.hmac = signQuery(q);
  q.code = 'tampered';
  assert.equal(verifyOAuthHmac(q, SECRET), false);
});

test('rejects a callback with no hmac', () => {
  assert.equal(verifyOAuthHmac({ shop: 'x' }, SECRET), false);
});

// ── completeInstall orchestration ────────────────────────────────────────────

function signedCallback(): Record<string, string> {
  const q: Record<string, string> = {
    shop: 'merchant.myshopify.com',
    code: 'auth_code',
    state: 'expected-state',
    timestamp: '1700000000',
  };
  q.hmac = signQuery(q);
  return q;
}

test('completes install: persists an active store with the fetched location', async () => {
  const stores = new InMemoryStoreRepository(ENC_KEY);
  const store = await completeInstall(signedCallback(), {
    stores,
    tokenExchanger: okExchanger,
    locationFetcher: okLocations,
    apiSecret: SECRET,
    expectedState: 'expected-state',
  });

  assert.equal(store.shopDomain, 'merchant.myshopify.com');
  assert.equal(store.status, 'active');
  assert.equal(store.primaryLocationId, 'gid://shopify/Location/42');

  // Round-trips through the repo with the token decrypted.
  const persisted = await stores.get('merchant.myshopify.com');
  assert.equal(persisted?.accessToken, 'shpat-fake-token');
});

test('rejects a state mismatch (CSRF) and persists nothing', async () => {
  const stores = new InMemoryStoreRepository(ENC_KEY);
  await assert.rejects(
    completeInstall(signedCallback(), {
      stores,
      tokenExchanger: okExchanger,
      locationFetcher: okLocations,
      apiSecret: SECRET,
      expectedState: 'a-different-state',
    }),
    /State mismatch/,
  );
  assert.equal(await stores.get('merchant.myshopify.com'), null);
});

test('rejects a bad HMAC and persists nothing', async () => {
  const stores = new InMemoryStoreRepository(ENC_KEY);
  const q = signedCallback();
  q.hmac = 'deadbeef';
  await assert.rejects(
    completeInstall(q, {
      stores,
      tokenExchanger: okExchanger,
      locationFetcher: okLocations,
      apiSecret: SECRET,
      expectedState: 'expected-state',
    }),
    /HMAC verification failed/,
  );
  assert.equal(await stores.get('merchant.myshopify.com'), null);
});

test('rejects an invalid shop domain in the callback', async () => {
  const stores = new InMemoryStoreRepository(ENC_KEY);
  const q: Record<string, string> = { shop: 'evil.com', code: 'c', state: 'expected-state' };
  q.hmac = signQuery(q);
  await assert.rejects(
    completeInstall(q, {
      stores,
      tokenExchanger: okExchanger,
      locationFetcher: okLocations,
      apiSecret: SECRET,
      expectedState: 'expected-state',
    }),
    /Invalid or missing shop/,
  );
});
