import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { ShopifyGraphQLClient } from '../shopify/client.js';
import type { Store } from '../types/index.js';
import { PerStoreRateLimitQueue, RateLimitedGraphQLClient } from './rateLimitQueue.js';

const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

test('serialises tasks for the same store (no overlap, FIFO order)', async () => {
  const q = new PerStoreRateLimitQueue();
  const events: string[] = [];

  const mk = (id: string, ms: number) => () =>
    (async () => {
      events.push(`start:${id}`);
      await delay(ms);
      events.push(`end:${id}`);
    })();

  // Enqueue A (slow) then B (fast) for the same store.
  const a = q.enqueue('shop', mk('A', 30));
  const b = q.enqueue('shop', mk('B', 1));
  await Promise.all([a, b]);

  // B must not start until A has ended.
  assert.deepEqual(events, ['start:A', 'end:A', 'start:B', 'end:B']);
});

test('runs different stores in parallel', async () => {
  const q = new PerStoreRateLimitQueue();
  const events: string[] = [];

  const a = q.enqueue('shopA', () =>
    (async () => {
      events.push('start:A');
      await delay(20);
      events.push('end:A');
    })(),
  );
  const b = q.enqueue('shopB', () =>
    (async () => {
      events.push('start:B');
      await delay(1);
      events.push('end:B');
    })(),
  );
  await Promise.all([a, b]);

  // B (other store) starts before A ends → they overlapped.
  assert.ok(events.indexOf('start:B') < events.indexOf('end:A'));
});

test('a failing task does not block later tasks for the same store', async () => {
  const q = new PerStoreRateLimitQueue();
  const failing = q.enqueue('shop', () => Promise.reject(new Error('boom')));
  await assert.rejects(failing, /boom/);

  const ok = await q.enqueue('shop', () => Promise.resolve(42));
  assert.equal(ok, 42);
});

test('propagates the task result to the caller', async () => {
  const q = new PerStoreRateLimitQueue();
  assert.equal(await q.enqueue('shop', () => Promise.resolve('value')), 'value');
});

test('RateLimitedGraphQLClient forwards to the inner client and serialises per store', async () => {
  let inFlight = 0;
  let maxConcurrent = 0;
  const inner: ShopifyGraphQLClient = {
    async query<T>(): Promise<T> {
      inFlight += 1;
      maxConcurrent = Math.max(maxConcurrent, inFlight);
      await delay(5);
      inFlight -= 1;
      return { ok: true } as T;
    },
  };
  const client = new RateLimitedGraphQLClient(inner, new PerStoreRateLimitQueue());
  const store: Store = {
    shopDomain: 'shop.myshopify.com',
    accessToken: 't',
    primaryLocationId: 'l',
    status: 'active',
    installedAt: new Date(),
    updatedAt: new Date(),
  };

  await Promise.all([
    client.query(store, '{a}'),
    client.query(store, '{b}'),
    client.query(store, '{c}'),
  ]);

  // Same store → never more than one call in flight at a time.
  assert.equal(maxConcurrent, 1);
});
