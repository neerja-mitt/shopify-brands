import assert from 'node:assert/strict';
import { test } from 'node:test';

import { computeSellableQty } from './sellable.js';

test('subtracts in-flight orders and the oversell buffer from the baseline', () => {
  assert.equal(
    computeSellableQty({
      lastSyncedShopifyQty: 10,
      grapeOrdersNotYetReflectedInShopify: 3,
      oversellBuffer: 2,
    }),
    5,
  );
});

test('never returns negative — clamps to 0 (under-sell, the safe direction)', () => {
  assert.equal(
    computeSellableQty({
      lastSyncedShopifyQty: 1,
      grapeOrdersNotYetReflectedInShopify: 0,
      oversellBuffer: 2,
    }),
    0,
  );
});

test("buffer holds back Shopify's last unit", () => {
  // 1 unit in Shopify, buffer of 1 → not sellable.
  assert.equal(
    computeSellableQty({
      lastSyncedShopifyQty: 1,
      grapeOrdersNotYetReflectedInShopify: 0,
      oversellBuffer: 1,
    }),
    0,
  );
});

test('zero buffer and no in-flight orders yields the raw baseline', () => {
  assert.equal(
    computeSellableQty({
      lastSyncedShopifyQty: 7,
      grapeOrdersNotYetReflectedInShopify: 0,
      oversellBuffer: 0,
    }),
    7,
  );
});
