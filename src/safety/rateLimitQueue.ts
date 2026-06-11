/**
 * Per-store rate-limit queue (spec §6 step 10, risk §8).
 *
 * Serialises Shopify work PER STORE (one in-flight call per shop at a time, with
 * an optional minimum gap between calls) while letting different stores run in
 * parallel. This keeps a single merchant's sync from spiking their Shopify rate
 * limit, and stops concurrent operations for the same store (e.g. a writeback
 * landing mid-import) from bursting.
 *
 * Built in from the start, as a decorator around the GraphQL client, so call
 * sites don't change — they just get throttled.
 */

import type { ShopifyGraphQLClient } from '../shopify/client.js';
import type { Store } from '../types/index.js';

const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export interface QueueOptions {
  /** Minimum gap between consecutive calls for the same store. Default 0. */
  minIntervalMs?: number;
}

export class PerStoreRateLimitQueue {
  /** Tail of each store's promise chain — new work appends after it. */
  private readonly tails = new Map<string, Promise<unknown>>();
  private readonly minIntervalMs: number;

  constructor(options: QueueOptions = {}) {
    this.minIntervalMs = options.minIntervalMs ?? 0;
  }

  /**
   * Enqueue work for a store. Runs after all prior work for that store settles
   * (and after the configured gap). Resolves/rejects with the task's outcome.
   */
  enqueue<T>(shopDomain: string, task: () => Promise<T>): Promise<T> {
    const prior = this.tails.get(shopDomain) ?? Promise.resolve();

    const result = prior.then(async () => {
      try {
        return await task();
      } finally {
        if (this.minIntervalMs > 0) await delay(this.minIntervalMs);
      }
    });

    // The next task waits on this one regardless of success/failure.
    this.tails.set(
      shopDomain,
      result.then(
        () => undefined,
        () => undefined,
      ),
    );
    return result;
  }
}

/**
 * Wraps a {@link ShopifyGraphQLClient} so every query is funnelled through the
 * per-store queue. Compose this at the root; downstream code is unchanged.
 */
export class RateLimitedGraphQLClient implements ShopifyGraphQLClient {
  private readonly inner: ShopifyGraphQLClient;
  private readonly queue: PerStoreRateLimitQueue;

  constructor(inner: ShopifyGraphQLClient, queue: PerStoreRateLimitQueue) {
    this.inner = inner;
    this.queue = queue;
  }

  query<T>(store: Store, query: string, variables?: Record<string, unknown>): Promise<T> {
    return this.queue.enqueue(store.shopDomain, () => this.inner.query<T>(store, query, variables));
  }
}
