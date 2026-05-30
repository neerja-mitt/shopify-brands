/**
 * Per-store rate-limit queue (SCAFFOLD — spec §6 step 10, risk §8).
 *
 * A throttled job queue PER STORE so multi-store syncs don't spike any single
 * merchant's Shopify API limits. Built in from the start, not bolted on.
 * Honours the cost/throttle signal Shopify returns on GraphQL responses.
 */

export interface QueuedJob {
  shopDomain: string;
  run: () => Promise<void>;
}

/**
 * Enqueue a unit of Shopify work for a given store. The queue paces execution
 * to stay under that store's rate limit and backs off when Shopify signals
 * throttling.
 */
export function enqueue(_job: QueuedJob): void {
  throw new Error('Not implemented (Phase 1): enqueue');
}
