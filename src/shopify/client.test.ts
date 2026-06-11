import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Store } from '../types/index.js';
import { RetryingGraphQLClient, ShopifyThrottledError, type ShopifyGraphQLClient } from './client.js';

const store: Store = {
  shopDomain: 'shop.myshopify.com',
  accessToken: 't',
  primaryLocationId: 'l',
  status: 'active',
  installedAt: new Date(),
  updatedAt: new Date(),
};

const noSleep = (): Promise<void> => Promise.resolve();

/** Inner client that throttles `failTimes` times, then returns a value. */
function flaky(failTimes: number): { client: ShopifyGraphQLClient; attempts: () => number } {
  let attempts = 0;
  const client: ShopifyGraphQLClient = {
    async query<T>(): Promise<T> {
      attempts += 1;
      if (attempts <= failTimes) throw new ShopifyThrottledError();
      return { ok: true } as T;
    },
  };
  return { client, attempts: () => attempts };
}

test('retries on throttle then succeeds', async () => {
  const { client, attempts } = flaky(2);
  const retrying = new RetryingGraphQLClient(client, { maxRetries: 4, sleep: noSleep });
  const result = await retrying.query<{ ok: boolean }>(store, '{x}');
  assert.deepEqual(result, { ok: true });
  assert.equal(attempts(), 3); // 2 throttles + 1 success
});

test('gives up after maxRetries and rethrows the throttle error', async () => {
  const { client, attempts } = flaky(10);
  const retrying = new RetryingGraphQLClient(client, { maxRetries: 2, sleep: noSleep });
  await assert.rejects(retrying.query(store, '{x}'), ShopifyThrottledError);
  assert.equal(attempts(), 3); // initial + 2 retries
});

test('does not retry non-throttle errors', async () => {
  let attempts = 0;
  const client: ShopifyGraphQLClient = {
    async query<T>(): Promise<T> {
      attempts += 1;
      throw new Error('schema error');
    },
  };
  const retrying = new RetryingGraphQLClient(client, { maxRetries: 4, sleep: noSleep });
  await assert.rejects(retrying.query(store, '{x}'), /schema error/);
  assert.equal(attempts, 1);
});

test('passes the result straight through when not throttled', async () => {
  const client: ShopifyGraphQLClient = {
    async query<T>(): Promise<T> {
      return { value: 42 } as T;
    },
  };
  const retrying = new RetryingGraphQLClient(client, { sleep: noSleep });
  assert.deepEqual(await retrying.query(store, '{x}'), { value: 42 });
});
