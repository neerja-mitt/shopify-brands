/**
 * Shopify GraphQL Admin API client (SCAFFOLD — spec §3 "API", Phase 1/2).
 *
 * GraphQL is chosen deliberately: one query pulls product + variants +
 * inventory + price together, cutting call count against rate limits (§8).
 * All Shopify traffic goes through this thin wrapper so auth, API-version
 * pinning, and throttle handling live in one place.
 */

import type { Store } from '../types/index.js';

export interface GraphQLResponse<T> {
  data?: T;
  errors?: unknown;
  /** Shopify cost/throttle extensions — drives the rate-limit queue (§6 step 10). */
  extensions?: { cost?: unknown };
}

/**
 * Execute a GraphQL Admin query/mutation against a specific store, using its
 * decrypted access token. Callers pass the query string + variables.
 */
export async function shopifyGraphQL<T>(
  _store: Store,
  _query: string,
  _variables?: Record<string, unknown>,
): Promise<GraphQLResponse<T>> {
  throw new Error('Not implemented (Phase 1): shopifyGraphQL');
}
